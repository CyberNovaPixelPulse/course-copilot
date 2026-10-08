import { randomUUID } from "crypto";
import { NextRequest, NextResponse } from "next/server";
import { parseScheduleImage, type AiCallMetric, type ScheduleMeeting } from "@/lib/parse-schedule";
import { logAiUsage } from "@/lib/turso";
import {
  consumeFreeScan,
  freeScansRemaining,
  incrementParse,
  readEntitlement,
  toUsagePublic,
  attachEntitlement,
  usageBilling,
  withAccountId,
  withFreeScans,
  type UsageBilling,
} from "@/lib/entitlement";
import { getGoogleSession } from "@/lib/session";
import { WEEKDAYS, type Course, type CourseSlot } from "@/lib/types";

export const maxDuration = 120;

const TURSO_LOG_FAILURE = "後台數據記錄失敗，系統已中斷此操作以防資料遺漏";

function tursoLoggingFailed(error: unknown) {
  return error instanceof Error && error.message.startsWith("[Turso Logging Failed]");
}

function tursoLoggingFailureResponse() {
  return NextResponse.json({ error: TURSO_LOG_FAILURE }, { status: 500 });
}

const ACCEPTED_TYPES = new Set(["image/png", "image/jpeg", "image/webp", "image/gif"]);
const MAX_BYTES = 15 * 1024 * 1024;

const TIME_MAP: Record<string, { start: string; end: string }> = {
  "1": { start: "07:10", end: "08:00" },
  "2": { start: "08:10", end: "09:00" },
  "3": { start: "09:10", end: "10:00" },
  "4": { start: "10:10", end: "11:00" },
  "5": { start: "11:10", end: "12:00" },
  "6": { start: "12:10", end: "13:00" },
  "7": { start: "13:10", end: "14:00" },
  "8": { start: "14:10", end: "15:00" },
  "9": { start: "15:10", end: "16:00" },
  "10": { start: "16:10", end: "17:00" },
  "11": { start: "17:10", end: "18:00" },
  "12": { start: "18:10", end: "19:00" },
  "13": { start: "19:10", end: "20:00" },
  "14": { start: "20:10", end: "21:00" },
  "15": { start: "21:10", end: "22:00" },
  A: { start: "07:15", end: "08:30" },
  B: { start: "08:45", end: "10:00" },
  C: { start: "10:15", end: "11:30" },
  D: { start: "11:45", end: "13:00" },
  E: { start: "13:15", end: "14:30" },
  F: { start: "14:45", end: "16:00" },
  G: { start: "16:15", end: "17:30" },
  H: { start: "17:45", end: "19:00" },
  I: { start: "19:15", end: "20:30" },
  J: { start: "20:45", end: "22:00" },
};

function timeToMinutes(value: string) {
  const match = value.trim().match(/^(\d{1,2}):(\d{2})$/);
  if (!match) return null;
  return Number(match[1]) * 60 + Number(match[2]);
}

function exactClock(value: string) {
  const match = value.trim().match(/^(\d{1,2})\s*[:：.]\s*(\d{2})$/);
  if (!match) return "";
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (hours > 23 || minutes > 59) return "";
  return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}`;
}

function formatMinutes(total: number) {
  return `${String(Math.floor(total / 60)).padStart(2, "0")}:${String(total % 60).padStart(2, "0")}`;
}

function cleanCourseName(name: string) {
  return name
    .replace(/^(?:[（(]\s*(?:\d{1,2}|[A-J])\s*[）)]\s*)+/i, "")
    .replace(/[（(]\s*\d{1,2}\s*[:：.]\s*\d{2}\s*[-~～至到]\s*\d{1,2}\s*[:：.]\s*\d{2}\s*[）)]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function periodCode(value: string) {
  const token = value
    .trim()
    .toUpperCase()
    .replace(/^[（(]\s*/, "")
    .replace(/\s*[）)]$/, "")
    .replace(/^第/, "")
    .replace(/節$/, "");
  if (/^[A-J]$/.test(token) || (/^\d{1,2}$/.test(token) && Number(token) >= 1 && Number(token) <= 15)) {
    return /^\d+$/.test(token) ? String(Number(token)) : token;
  }
  return "";
}

function leadingCode(text: string) {
  let rest = text.trim();
  let letter = "";
  let digit = "";
  const marker = /^[（(]\s*([A-Ja-j]|\d{1,2})\s*[）)]\s*/;
  while (true) {
    const match = rest.match(marker);
    if (!match) break;
    const code = periodCode(match[1]);
    if (/^[A-J]$/.test(code)) letter = letter || code;
    else if (code) digit = digit || code;
    rest = rest.slice(match[0].length);
  }
  return { code: letter || digit, rest };
}

function markerCode(marker: string) {
  const withoutClocks = marker.replace(/\d{1,2}\s*[:：.]\s*\d{2}/g, " ");
  const tokens = withoutClocks.toUpperCase().match(/[A-J](?![A-Z])|\d{1,2}/g) ?? [];
  for (const token of tokens) {
    const code = periodCode(token);
    if (/^[A-J]$/.test(code)) return code;
  }
  for (const token of tokens) {
    const code = periodCode(token);
    if (code) return code;
  }
  return "";
}

function clocksIn(text: string) {
  const matches = [...text.matchAll(/(\d{1,2})\s*[:：.]\s*(\d{2})/g)];
  if (matches.length < 2) return null;
  const start = exactClock(`${matches[0][1]}:${matches[0][2]}`);
  const end = exactClock(`${matches[matches.length - 1][1]}:${matches[matches.length - 1][2]}`);
  const startMinutes = timeToMinutes(start);
  const endMinutes = timeToMinutes(end);
  if (!start || !end || startMinutes === null || endMinutes === null || endMinutes <= startMinutes) return null;
  return { start, end };
}

export type ScheduleTableRow = {
  marker: string;
  cells: [string, string, string, string, string];
};

function splitTableLine(line: string) {
  let raw = line.trim().replaceAll("｜", "|");
  if (raw.startsWith("|")) raw = raw.slice(1);
  if (raw.endsWith("|")) raw = raw.slice(0, -1);
  return raw.split("|").map((cell) => cell.replace(/<br\s*\/?>/gi, "\n").trim());
}

function isDividerRow(cells: string[]) {
  return cells.length > 0 && cells.every((cell) => /^:?-{2,}:?$/.test(cell.replace(/\s/g, "")));
}

function isHeaderRow(cells: string[]) {
  return /週一|周一|星期一|monday/i.test(cells.join(" "));
}

export function parseMarkdownTable(markdown: string): ScheduleTableRow[] {
  const source = markdown
    .replace(/```(?:markdown|md)?/gi, "")
    .replace(/```/g, "");
  const rows: ScheduleTableRow[] = [];
  let skippedHeader = false;
  for (const line of source.split(/\r?\n/)) {
    if (!line.includes("|") && !line.includes("｜")) continue;
    const cells = splitTableLine(line);
    if (cells.length < 2 || isDividerRow(cells)) continue;
    if (!skippedHeader && isHeaderRow(cells)) {
      skippedHeader = true;
      continue;
    }
    const [marker = "", ...days] = cells;
    const padded = [...days, "", "", "", "", ""].slice(0, 5) as [
      string,
      string,
      string,
      string,
      string,
    ];
    rows.push({ marker, cells: padded });
  }
  return rows;
}

function slotFromCodes(codes: string[], weekday: CourseSlot["weekday"], room: string): CourseSlot | null {
  const known = codes.filter((code) => TIME_MAP[code]);
  const chosen = known.some((code) => /^[A-J]$/.test(code))
    ? known.filter((code) => /^[A-J]$/.test(code))
    : known.filter((code) => /^\d+$/.test(code));
  if (chosen.length === 0) return null;
  const starts = chosen.map((code) => timeToMinutes(TIME_MAP[code].start) ?? Number.POSITIVE_INFINITY);
  const ends = chosen.map((code) => timeToMinutes(TIME_MAP[code].end) ?? 0);
  const start = Math.min(...starts);
  const end = Math.max(...ends);
  if (!Number.isFinite(start) || end <= start) return null;
  const startHour = Math.floor(start / 60);
  const endHour = Math.floor(end / 60);
  return {
    weekday,
    startTime: `${String(startHour).padStart(2, "0")}:${String(start % 60).padStart(2, "0")}`,
    endTime: `${String(endHour).padStart(2, "0")}:${String(end % 60).padStart(2, "0")}`,
    location: room,
  };
}

export function coursesFromMarkdown(markdown: string): Course[] {
  const table = parseMarkdownTable(markdown);
  const grouped = new Map<string, { name: string; slots: CourseSlot[] }>();

  for (let column = 0; column < 5; column += 1) {
    const weekday = WEEKDAYS[column];
    let run: { name: string; room: string; codes: string[]; start: string; end: string } | null = null;
    const flush = () => {
      if (!run) return;
      const fromCodes = slotFromCodes(run.codes, weekday, run.room);
      const slot =
        fromCodes ??
        (run.start && run.end
          ? { weekday, startTime: run.start, endTime: run.end, location: run.room }
          : null);
      if (slot) {
        const key = run.name.toLowerCase();
        const course = grouped.get(key) ?? { name: run.name, slots: [] };
        const exists = course.slots.some(
          (other) =>
            other.weekday === slot.weekday &&
            other.startTime === slot.startTime &&
            other.endTime === slot.endTime,
        );
        if (!exists) course.slots.push(slot);
        grouped.set(key, course);
      }
      run = null;
    };

    for (const row of table) {
      const raw = row.cells[column].trim();
      if (!raw) {
        flush();
        continue;
      }
      const marked = leadingCode(raw);
      const lines = marked.rest.split(/\n+/).map((line) => line.trim()).filter(Boolean);
      const name = cleanCourseName(lines[0] ?? "");
      const room = lines.slice(1).join(" ").trim();
      if (!name) {
        flush();
        continue;
      }
      const code = marked.code || markerCode(row.marker);
      const clocks = code ? null : clocksIn(`${row.marker} ${raw}`);
      if (run && run.name === name) {
        if (code) run.codes.push(code);
        if (!run.room && room) run.room = room;
        if (!code && clocks) run.end = clocks.end;
        continue;
      }
      flush();
      run = {
        name,
        room,
        codes: code ? [code] : [],
        start: clocks?.start ?? "",
        end: clocks?.end ?? "",
      };
    }
    flush();
  }

  return [...grouped.values()]
    .map((course) => ({
      name: course.name,
      professor: "",
      slots: course.slots.sort(
        (a, b) =>
          WEEKDAYS.indexOf(a.weekday) - WEEKDAYS.indexOf(b.weekday) ||
          (timeToMinutes(a.startTime) ?? 0) - (timeToMinutes(b.startTime) ?? 0),
      ),
    }))
    .filter((course) => course.slots.length > 0);
}

const TURSO_TIMEOUT_MS = 15_000;
const PARSE_TIMEOUT_MS = 45_000;

function withTimeout<T>(work: Promise<T>, ms: number, message: string) {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(message)), ms);
  });
  return Promise.race([work, timeout]).finally(() => {
    if (timer) clearTimeout(timer);
  });
}

function isTimeoutError(error: unknown) {
  const name = error && typeof error === "object" && "name" in error ? String(error.name) : "";
  const message = error instanceof Error ? error.message : "";
  return name === "TimeoutError" || name === "AbortError" || name === "APIConnectionTimeoutError" || /timed out|timeout|aborted/i.test(message);
}

const PERIOD_BREAK_MINUTES = 20;

function codesInText(text: string) {
  const codes: string[] = [];
  for (const match of text.matchAll(/[（(]\s*([A-Ja-j]|\d{1,2})\s*[）)]/g)) {
    const code = periodCode(match[1]);
    if (code) codes.push(code);
  }
  return codes;
}

function spansOverlap(left: { startTime: string; endTime: string }, right: { startTime: string; endTime: string }) {
  const leftStart = timeToMinutes(left.startTime);
  const leftEnd = timeToMinutes(left.endTime);
  const rightStart = timeToMinutes(right.startTime);
  const rightEnd = timeToMinutes(right.endTime);
  if (leftStart === null || leftEnd === null || rightStart === null || rightEnd === null) return false;
  return leftStart < rightEnd && rightStart < leftEnd;
}

function slotFromRun(codes: string[], weekday: CourseSlot["weekday"], room: string): CourseSlot | null {
  const clocks = codes.map((code) => TIME_MAP[code]).filter(Boolean);
  if (clocks.length === 0) return null;
  const start = Math.min(...clocks.map((clock) => timeToMinutes(clock.start) ?? Number.POSITIVE_INFINITY));
  const end = Math.max(...clocks.map((clock) => timeToMinutes(clock.end) ?? 0));
  if (!Number.isFinite(start) || end <= start) return null;
  return { weekday, startTime: formatMinutes(start), endTime: formatMinutes(end), location: room };
}

function slotsFromPeriodCodes(codes: string[], weekday: CourseSlot["weekday"], room: string) {
  const unique = [...new Set(codes)];
  const letters = unique.filter((code) => /^[A-J]$/.test(code)).sort();
  const numbers = unique
    .filter((code) => /^\d+$/.test(code))
    .map(Number)
    .sort((left, right) => left - right);

  const letterRuns: string[][] = [];
  for (const letter of letters) {
    const run = letterRuns[letterRuns.length - 1];
    if (run && letter.charCodeAt(0) === run[run.length - 1].charCodeAt(0) + 1) run.push(letter);
    else letterRuns.push([letter]);
  }
  const numberRuns: number[][] = [];
  for (const period of numbers) {
    const run = numberRuns[numberRuns.length - 1];
    if (run && period === run[run.length - 1] + 1) run.push(period);
    else numberRuns.push([period]);
  }

  const letterSlots = letterRuns
    .map((run) => slotFromRun(run, weekday, room))
    .filter((slot): slot is CourseSlot => Boolean(slot));
  const numberSlots = numberRuns
    .map((run) => slotFromRun(run.map(String), weekday, room))
    .filter((slot): slot is CourseSlot => Boolean(slot))
    .filter((slot) => !letterSlots.some((letter) => spansOverlap(slot, letter)));
  return [...letterSlots, ...numberSlots];
}

function mergeTouchingSlots(slots: CourseSlot[]) {
  const merged: CourseSlot[] = [];
  for (const weekday of WEEKDAYS) {
    const daySlots = slots
      .filter((slot) => slot.weekday === weekday)
      .sort((left, right) => (timeToMinutes(left.startTime) ?? 0) - (timeToMinutes(right.startTime) ?? 0));
    for (const slot of daySlots) {
      const start = timeToMinutes(slot.startTime);
      const end = timeToMinutes(slot.endTime);
      if (start === null || end === null || end <= start) continue;
      const current = merged[merged.length - 1];
      const currentEnd = current?.weekday === weekday ? timeToMinutes(current.endTime) : null;
      if (current && current.weekday === weekday && currentEnd !== null && start <= currentEnd + PERIOD_BREAK_MINUTES) {
        if (end > currentEnd) current.endTime = slot.endTime;
        if (!current.location && slot.location) current.location = slot.location;
        continue;
      }
      merged.push({ ...slot });
    }
  }
  return merged;
}

export function coursesFromMeetings(meetings: ScheduleMeeting[]): Course[] {
  const grouped = new Map<
    string,
    { name: string; days: Map<CourseSlot["weekday"], { codes: string[]; room: string; ranges: CourseSlot[] }> }
  >();

  for (const meeting of meetings) {
    const name = cleanCourseName(meeting.name);
    const weekday = WEEKDAYS[meeting.day - 1];
    if (!name || !weekday) continue;
    const key = name.toLowerCase();
    const course = grouped.get(key) ?? { name, days: new Map() };
    const day = course.days.get(weekday) ?? { codes: [], room: "", ranges: [] };
    const codes = [
      ...meeting.periods.map(periodCode).filter(Boolean),
      ...codesInText(meeting.name),
    ];
    day.codes.push(...codes);
    if (!day.room && meeting.room) day.room = meeting.room;
    if (codes.length === 0) {
      const start = exactClock(meeting.start);
      const end = exactClock(meeting.end);
      const printed = clocksIn(meeting.name);
      if (start && end && (timeToMinutes(start) ?? 0) < (timeToMinutes(end) ?? 0)) {
        day.ranges.push({ weekday, startTime: start, endTime: end, location: meeting.room });
      } else if (printed) {
        day.ranges.push({ weekday, startTime: printed.start, endTime: printed.end, location: meeting.room });
      }
    }
    course.days.set(weekday, day);
    grouped.set(key, course);
  }

  return [...grouped.values()]
    .map((course) => {
      const slots: CourseSlot[] = [];
      for (const [weekday, day] of course.days) {
        slots.push(...slotsFromPeriodCodes(day.codes, weekday, day.room), ...day.ranges);
      }
      return {
        name: course.name,
        professor: "",
        slots: mergeTouchingSlots(slots).filter(
          (slot) => WEEKDAYS.includes(slot.weekday) && slot.startTime && slot.endTime,
        ),
      };
    })
    .filter((course) => course.slots.length > 0);
}

function countEvents(courses: Course[]) {
  return courses.reduce((total, course) => total + (course.slots?.length ?? 0), 0);
}

function createTaskId() {
  const date = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Taipei",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  })
    .format(new Date())
    .replaceAll("-", "");
  const suffix = randomUUID().replace(/-/g, "").slice(0, 6);
  return `task_${date}_${suffix}`;
}

export async function POST(request: NextRequest) {
  const taskId = createTaskId();
  let billing: UsageBilling = { payment_type: "free", fee_charged_twd: 0, coupon_code: null };
  let eventsCount = 0;
  let mimeType = "";

  async function logParseCall(params: {
    model: string;
    inputTokens: number;
    outputTokens: number;
    latencyMs: number;
    status: string;
    step: number;
    metadata?: Record<string, unknown>;
  }) {
    try {
      console.log("[Turso Log] 開始寫入記錄至 Turso...");
      await withTimeout(
        logAiUsage({
          siteId: "course-copilot",
          model: params.model || "gpt-4o",
          inputTokens: params.inputTokens,
          outputTokens: params.outputTokens,
          latencyMs: Math.round(params.latencyMs),
          status: params.status,
          metadata: {
            ...params.metadata,
            task_id: taskId,
            step: params.step,
            payment_type: billing.payment_type,
            fee_charged_twd: billing.fee_charged_twd,
            coupon_code: billing.coupon_code,
            events_count: eventsCount,
          },
        }),
        TURSO_TIMEOUT_MS,
        "Turso write timed out",
      );
      console.log("[Turso Log] 成功寫入 Turso！");
    } catch (err) {
      console.error("[Turso Log Error] 寫入失敗原因：", err);
      const message = err instanceof Error ? err.message : String(err);
      throw new Error(`[Turso Logging Failed] ${message}`);
    }
  }

  try {
    const session = await getGoogleSession();
    const authenticated = Boolean(session);
    if (!authenticated) {
      return NextResponse.json(
        { error: "Sign in with Google to use your 3 free scans.", requiresAuth: true },
        { status: 401 },
      );
    }
    const googleId = session?.user?.id || session?.user?.email;
    let entitlement = readEntitlement(request);
    if (googleId) entitlement = withAccountId(entitlement, googleId);
    entitlement = withFreeScans(entitlement, true);
    billing = usageBilling(entitlement);
    if (!entitlement.paid && freeScansRemaining(entitlement, true) <= 0) {
      const response = NextResponse.json(
        {
          error: "Free scans are used up. Unlock the paid plan to keep scanning.",
          requiresPayment: true,
          usage: toUsagePublic(entitlement, true),
        },
        { status: 402 },
      );
      attachEntitlement(response, entitlement);
      return response;
    }
    const modelName = "gpt-4o";
    console.log("Currently using model:", modelName);

    let formData: FormData;
    try {
      formData = await request.formData();
    } catch {
      return NextResponse.json(
        { error: "Please upload a course schedule screenshot." },
        { status: 400 },
      );
    }

    const image = formData.get("image");

    if (!(image instanceof File) || image.size === 0) {
      return NextResponse.json(
        { error: "Please upload a course schedule screenshot." },
        { status: 400 },
      );
    }

    if (!ACCEPTED_TYPES.has(image.type)) {
      return NextResponse.json(
        { error: "Unsupported file type. Use PNG, JPG, WEBP, or GIF." },
        { status: 400 },
      );
    }

    if (image.size > MAX_BYTES) {
      return NextResponse.json(
        { error: "Image is too large. Please upload a file under 15 MB." },
        { status: 400 },
      );
    }

    mimeType = image.type;
    const buffer = Buffer.from(await image.arrayBuffer());
    const imagePayload = {
      mimeType: image.type,
      base64: buffer.toString("base64"),
    };

    if (!imagePayload.base64) {
      return NextResponse.json(
        { error: "Please upload a course schedule screenshot." },
        { status: 400 },
      );
    }

    const parsedResult = await parseScheduleImage({
      ...imagePayload,
      model: "gpt-4o",
      signal: AbortSignal.timeout(PARSE_TIMEOUT_MS),
    });
    const courses = coursesFromMeetings(parsedResult.meetings);
    eventsCount = countEvents(courses);
    for (const [index, call] of parsedResult.calls.entries()) {
      await logParseCall({
        model: call.model,
        inputTokens: call.inputTokens,
        outputTokens: call.outputTokens,
        latencyMs: call.latencyMs,
        status: "success",
        step: index + 1,
        metadata: {
          stage: call.stage,
          mimeType: image.type,
          courseCount: courses.length,
          periodCount: parsedResult.meetings.reduce((total, meeting) => total + meeting.periods.length, 0),
          paid: entitlement.paid,
        },
      });
    }

    if (courses.length === 0) {
      return NextResponse.json(
        { error: "沒有辨識到課程，請換一張更清楚的課表再試一次。", courses: [] },
        { status: 422 },
      );
    }

    const next = entitlement.paid ? incrementParse(entitlement, "gpt-4o") : consumeFreeScan(entitlement);
    const usage = toUsagePublic(next, authenticated);
    const response = NextResponse.json({ courses, usage, model: "gpt-4o" });
    attachEntitlement(response, next);
    return response;
  } catch (error) {
    if (tursoLoggingFailed(error)) return tursoLoggingFailureResponse();
    if (isTimeoutError(error)) {
      return NextResponse.json({ error: "讀取課表逾時，請稍後再試。", courses: [] }, { status: 504 });
    }

    const message =
      error instanceof Error ? error.message : "Failed to parse the schedule image.";
    const calls =
      error && typeof error === "object" && Array.isArray((error as { aiCalls?: AiCallMetric[] }).aiCalls)
        ? (error as { aiCalls: AiCallMetric[] }).aiCalls
        : [];
    const failureMeta = { message, mimeType: mimeType || undefined };
    try {
      if (calls.length === 0) {
        await logParseCall({
          model: "gpt-4o",
          inputTokens: 0,
          outputTokens: 0,
          latencyMs: 0,
          status: "error",
          step: 1,
          metadata: failureMeta,
        });
      } else {
        for (const [index, call] of calls.entries()) {
          await logParseCall({
            model: call.model,
            inputTokens: call.inputTokens,
            outputTokens: call.outputTokens,
            latencyMs: call.latencyMs,
            status: "success",
            step: index + 1,
            metadata: { stage: call.stage, mimeType: mimeType || undefined },
          });
        }
        await logParseCall({
          model: "gpt-4o",
          inputTokens: 0,
          outputTokens: 0,
          latencyMs: 0,
          status: "error",
          step: calls.length + 1,
          metadata: {
            ...failureMeta,
            completedStages: calls.map((call) => call.stage),
          },
        });
      }
    } catch (logError) {
      if (tursoLoggingFailed(logError)) return tursoLoggingFailureResponse();
      const logMessage = logError instanceof Error ? logError.message : "Failed to parse the schedule image.";
      return NextResponse.json({ error: logMessage, courses: [] }, { status: 500 });
    }
    const status = message.includes("OPENAI_API_KEY") ? 500 : 502;
    return NextResponse.json({ error: message, courses: [] }, { status });
  }
}
