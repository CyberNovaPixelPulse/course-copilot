import { createHash, randomUUID } from "crypto";
import { NextRequest, NextResponse } from "next/server";
import {
  parseScheduleImage,
  type AiCallMetric,
  type ScheduleMeeting,
} from "@/lib/parse-schedule";
import { logAiUsage } from "@/lib/turso";
import {
  accountStore,
  accountUsage,
  accountFailure,
  signedInAccount,
} from "@/lib/account-access";
import { AccountError } from "@/lib/account-entitlements";
import { WEEKDAYS, type Course, type CourseSlot } from "@/lib/types";

export const maxDuration = 120;

const TURSO_LOG_FAILURE = "後台數據記錄失敗，系統已中斷此操作以防資料遺漏";

function tursoLoggingFailed(error: unknown) {
  return (
    error instanceof Error && error.message.startsWith("[Turso Logging Failed]")
  );
}

function tursoLoggingFailureResponse() {
  return NextResponse.json({ error: TURSO_LOG_FAILURE }, { status: 500 });
}

const ACCEPTED_TYPES = new Set([
  "image/png",
  "image/jpeg",
  "image/webp",
  "image/gif",
]);
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

function formatMinutes(total: number) {
  return `${String(Math.floor(total / 60)).padStart(2, "0")}:${String(total % 60).padStart(2, "0")}`;
}

function cleanCourseName(name: string) {
  return name
    .replace(/^(?:[（(]\s*(?:\d{1,2}|[A-J])\s*[）)]\s*)+/i, "")
    .replace(
      /[（(]\s*\d{1,2}\s*[:：.]\s*\d{2}\s*[-~～至到]\s*\d{1,2}\s*[:：.]\s*\d{2}\s*[）)]/g,
      "",
    )
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
  if (
    /^[A-J]$/.test(token) ||
    (/^\d{1,2}$/.test(token) && Number(token) >= 1 && Number(token) <= 15)
  ) {
    return /^\d+$/.test(token) ? String(Number(token)) : token;
  }
  return "";
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
  const name =
    error && typeof error === "object" && "name" in error
      ? String(error.name)
      : "";
  const message = error instanceof Error ? error.message : "";
  return (
    name === "TimeoutError" ||
    name === "AbortError" ||
    name === "APIConnectionTimeoutError" ||
    /timed out|timeout|aborted/i.test(message)
  );
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

function spansOverlap(
  left: { startTime: string; endTime: string },
  right: { startTime: string; endTime: string },
) {
  const leftStart = timeToMinutes(left.startTime);
  const leftEnd = timeToMinutes(left.endTime);
  const rightStart = timeToMinutes(right.startTime);
  const rightEnd = timeToMinutes(right.endTime);
  if (
    leftStart === null ||
    leftEnd === null ||
    rightStart === null ||
    rightEnd === null
  )
    return false;
  return leftStart < rightEnd && rightStart < leftEnd;
}

function slotFromRun(
  codes: string[],
  weekday: CourseSlot["weekday"],
  room: string,
): CourseSlot | null {
  const clocks = codes.map((code) => TIME_MAP[code]).filter(Boolean);
  if (clocks.length === 0) return null;
  const start = Math.min(
    ...clocks.map(
      (clock) => timeToMinutes(clock.start) ?? Number.POSITIVE_INFINITY,
    ),
  );
  const end = Math.max(...clocks.map((clock) => timeToMinutes(clock.end) ?? 0));
  if (!Number.isFinite(start) || end <= start) return null;
  return {
    weekday,
    startTime: formatMinutes(start),
    endTime: formatMinutes(end),
    location: room,
  };
}

function slotsFromPeriodCodes(
  codes: string[],
  weekday: CourseSlot["weekday"],
  room: string,
) {
  const unique = [...new Set(codes)];
  const letters = unique.filter((code) => /^[A-J]$/.test(code)).sort();
  const numbers = unique
    .filter((code) => /^\d+$/.test(code))
    .map(Number)
    .sort((left, right) => left - right);

  const letterRuns: string[][] = [];
  for (const letter of letters) {
    const run = letterRuns[letterRuns.length - 1];
    if (run && letter.charCodeAt(0) === run[run.length - 1].charCodeAt(0) + 1)
      run.push(letter);
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
    .filter(
      (slot) => !letterSlots.some((letter) => spansOverlap(slot, letter)),
    );
  return [...letterSlots, ...numberSlots];
}

function mergeTouchingSlots(slots: CourseSlot[]) {
  const merged: CourseSlot[] = [];
  for (const weekday of WEEKDAYS) {
    const daySlots = slots
      .filter((slot) => slot.weekday === weekday)
      .sort(
        (left, right) =>
          (timeToMinutes(left.startTime) ?? 0) -
          (timeToMinutes(right.startTime) ?? 0),
      );
    for (const slot of daySlots) {
      const start = timeToMinutes(slot.startTime);
      const end = timeToMinutes(slot.endTime);
      if (start === null || end === null || end <= start) continue;
      const current = merged[merged.length - 1];
      const currentEnd =
        current?.weekday === weekday ? timeToMinutes(current.endTime) : null;
      if (
        current &&
        current.weekday === weekday &&
        currentEnd !== null &&
        start <= currentEnd + PERIOD_BREAK_MINUTES
      ) {
        if (end > currentEnd) current.endTime = slot.endTime;
        if (!current.location && slot.location)
          current.location = slot.location;
        continue;
      }
      merged.push({ ...slot });
    }
  }
  return merged;
}

function coursesFromMeetings(meetings: ScheduleMeeting[]): Course[] {
  const grouped = new Map<
    string,
    {
      name: string;
      days: Map<
        CourseSlot["weekday"],
        { codes: string[]; room: string; ranges: CourseSlot[] }
      >;
    }
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
    course.days.set(weekday, day);
    grouped.set(key, course);
  }

  return [...grouped.values()]
    .map((course) => {
      const slots: CourseSlot[] = [];
      for (const [weekday, day] of course.days) {
        slots.push(
          ...slotsFromPeriodCodes(day.codes, weekday, day.room),
          ...day.ranges,
        );
      }
      return {
        name: course.name,
        professor: "",
        slots: mergeTouchingSlots(slots).filter(
          (slot) =>
            WEEKDAYS.includes(slot.weekday) && slot.startTime && slot.endTime,
        ),
      };
    })
    .filter((course) => course.slots.length > 0)
    .sort((left, right) => {
      const leftDay = WEEKDAYS.indexOf(left.slots[0]?.weekday ?? "Monday");
      const rightDay = WEEKDAYS.indexOf(right.slots[0]?.weekday ?? "Monday");
      if (leftDay !== rightDay) return leftDay - rightDay;
      if (left.name < right.name) return -1;
      if (left.name > right.name) return 1;
      return 0;
    });
}

function countEvents(courses: Course[]) {
  return courses.reduce(
    (total, course) => total + (course.slots?.length ?? 0),
    0,
  );
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
  let accountId = "";
  let jobId = "";
  let reserved = false;
  let creditBucket = "unreserved";
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
            credit_bucket: creditBucket,
            // A pooled account credit does not identify a payment or coupon.
            payment_type: creditBucket === "free" ? "free" : "account_credit",
            fee_charged_twd: 0,
            coupon_code: null,
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
    accountId = await signedInAccount();
    const usageBefore = await accountUsage(accountId);
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

    const submittedId = formData.get("jobId");
    jobId = typeof submittedId === "string" ? submittedId : "";
    const fingerprint = createHash("sha256").update(buffer).digest("hex");
    const job = await accountStore().begin(accountId, jobId, fingerprint);
    if (!job.started) {
      const usage = await accountUsage(accountId);
      return NextResponse.json(
        { jobId, state: job.state, courses: job.courses ?? [], usage },
        {
          status:
            job.state === "running"
              ? 202
              : job.state === "succeeded" && job.courses
                ? 200
                : 409,
          headers: { "Cache-Control": "no-store" },
        },
      );
    }
    reserved = true;
    creditBucket = job.funding;
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
          periodCount: parsedResult.meetings.reduce(
            (total, meeting) => total + meeting.periods.length,
            0,
          ),
          paid: usageBefore.canExportIcs,
        },
      });
    }

    if (courses.length === 0) {
      return NextResponse.json(
        {
          error: "沒有辨識到課程，請換一張更清楚的課表再試一次。",
          courses: [],
        },
        { status: 422 },
      );
    }

    try {
      await accountStore().complete(accountId, jobId, courses);
    } catch (e) {
      return accountFailure(e);
    }
    reserved = false;
    const usage = await accountUsage(accountId);
    return NextResponse.json(
      { courses, usage, model: "gpt-4o", jobId, state: "succeeded" },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    if (error instanceof AccountError) return accountFailure(error);
    if (!reserved) return accountFailure(error);
    if (tursoLoggingFailed(error)) return tursoLoggingFailureResponse();
    if (isTimeoutError(error)) {
      return NextResponse.json(
        { error: "讀取課表逾時，請稍後再試。", courses: [] },
        { status: 504 },
      );
    }

    const message =
      error instanceof Error
        ? error.message
        : "Failed to parse the schedule image.";
    const calls =
      error &&
      typeof error === "object" &&
      Array.isArray((error as { aiCalls?: AiCallMetric[] }).aiCalls)
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
      const logMessage =
        logError instanceof Error
          ? logError.message
          : "Failed to parse the schedule image.";
      return NextResponse.json(
        { error: logMessage, courses: [] },
        { status: 500 },
      );
    }
    const status = message.includes("OPENAI_API_KEY") ? 500 : 502;
    return NextResponse.json({ error: message, courses: [] }, { status });
  } finally {
    if (reserved) {
      try {
        await accountStore().fail(accountId, jobId);
      } catch {
        console.error(
          "Unable to release recognition reservation; expiry will recover it.",
        );
      }
    }
  }
}
