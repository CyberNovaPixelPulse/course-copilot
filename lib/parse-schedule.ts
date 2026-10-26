import type { Course, CourseSlot } from "./types";
import { WEEKDAYS } from "./types";
import { readScheduleModel } from "./schedule-model";
import { logRecognitionUsage } from "./turso";

export type ScheduleImage = { mimeType: string; base64: string };
export type ModelReply = {
  content: string;
  model: string;
  inputTokens: number | null;
  outputTokens: number | null;
  latencyMs: number;
};
export type RecognitionRecord = {
  accountId: string;
  jobId: string;
  creditBucket: string;
  model: string;
  inputTokens: number | null;
  outputTokens: number | null;
  latencyMs: number;
  modelStatus: "responded" | "failed";
  normalizationStatus: "succeeded" | "failed";
  failureCode: string | null;
  courseCount: number;
  eventCount: number;
};
type RecognitionContext = {
  accountId: string;
  jobId: string;
  creditBucket: string;
};
type Dependencies = {
  model: (
    image: ScheduleImage & { signal: AbortSignal },
  ) => Promise<ModelReply>;
  record: (record: RecognitionRecord) => Promise<void>;
};

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

export type RecognitionCode =
  | "invalid_response"
  | "invalid_columns"
  | "inconsistent_columns"
  | "invalid_day"
  | "missing_name"
  | "missing_periods"
  | "unknown_period"
  | "empty_result"
  | "period_conflict"
  | "room_conflict"
  | "model_timeout"
  | "model_unavailable"
  | "model_failed"
  | "logging_failed";
const messages: Record<RecognitionCode, string> = {
  invalid_response: "辨識回應格式不完整，請重新裁切課表後再試。",
  invalid_columns: "無法確認完整的週一至週五欄位，請重新裁切課表。",
  inconsistent_columns: "星期欄與課程資料前後不一致，請檢查圖片中的欄位。",
  invalid_day: "課程星期不在目前支援的週一至週五範圍。",
  missing_name: "有課程缺少名稱，請使用更清楚的課表。",
  missing_periods: "有課程缺少可用節次，請檢查課表節次是否清楚。",
  unknown_period: "課程節次不在目前支援的範圍，請檢查圖片。",
  empty_result: "沒有辨識到可用課程，請換一張更清楚的課表。",
  period_conflict: "同一課程的字母與數字節次互相重疊，請檢查節次。",
  room_conflict: "同一課程在相同時段出現不同教室，請檢查課表。",
  model_timeout: "讀取課表逾時，請稍後再試，本次未扣次。",
  model_unavailable: "辨識功能暫時無法使用，請稍後再試。",
  model_failed: "辨識暫時失敗，請稍後再試，本次未扣次。",
  logging_failed: "必要辨識記錄暫時無法保存，本次未扣次，請稍後重試。",
};
export class RecognitionError extends Error {
  constructor(
    public code: RecognitionCode,
    public details: { course?: string; period?: string; day?: number } = {},
  ) {
    const suffix = [
      details.course,
      details.period,
      details.day ? `星期欄 ${details.day}` : undefined,
    ]
      .filter(Boolean)
      .join(" · ");
    super(messages[code] + (suffix ? `（${suffix}）` : ""));
  }
}
type Meeting = { name: string; day: number; periods: string[]; room: string };
function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new RecognitionError("invalid_response");
  return value as Record<string, unknown>;
}
function text(value: unknown) {
  return typeof value === "string" ? value.replace(/\s+/g, " ").trim() : "";
}
function period(value: unknown, name: string) {
  const raw = text(value)
    .toUpperCase()
    .replace(/^[（(]\s*/, "")
    .replace(/\s*[）)]$/, "")
    .replace(/^第/, "")
    .replace(/節$/, "");
  const code = /^\d{1,2}$/.test(raw) ? String(Number(raw)) : raw;
  if (!Object.hasOwn(TIME_MAP, code))
    throw new RecognitionError("unknown_period", {
      course: name.slice(0, 100),
      period: text(value).slice(0, 30),
    });
  return code;
}
function meeting(value: unknown, cell = false): Meeting {
  const row = object(value);
  const name = text(row.name)
    .replace(/^(?:[（(]\s*(?:\d{1,2}|[A-J])\s*[）)]\s*)+/i, "")
    .replace(
      /[（(]\s*\d{1,2}\s*[:：.]\s*\d{2}\s*[-~～至到]\s*\d{1,2}\s*[:：.]\s*\d{2}\s*[）)]/g,
      "",
    )
    .replace(/\s+/g, " ")
    .trim();
  if (!name) throw new RecognitionError("missing_name");
  const day = cell ? row.column : row.day;
  if (typeof day !== "number" || !Number.isInteger(day) || day < 1 || day > 5)
    throw new RecognitionError("invalid_day", { course: name.slice(0, 100) });
  const codes = cell ? row.codes : row.periods;
  if (!Array.isArray(codes) || !codes.length)
    throw new RecognitionError("missing_periods", {
      course: name.slice(0, 100),
    });
  if (row.room !== undefined && typeof row.room !== "string")
    throw new RecognitionError("invalid_response");
  return {
    name,
    day,
    periods: [...new Set(codes.map((c) => period(c, name)))],
    room: text(row.room),
  };
}
function coursesFromPayload(payload: unknown): Course[] {
  const root = object(payload);
  if (!Array.isArray(root.courses))
    throw new RecognitionError("invalid_response");
  const rows = root.courses.map((c) => meeting(c));
  const scratch = object(root.scratchpad);
  if (
    !Array.isArray(scratch.columns) ||
    scratch.columns.length !== 5 ||
    !Array.isArray(scratch.cells)
  )
    throw new RecognitionError("invalid_columns");
  const columns = new Map<number, string>();
  for (const entry of scratch.columns) {
    const column = object(entry);
    if (
      typeof column.column !== "number" ||
      !Number.isInteger(column.column) ||
      column.column < 1 ||
      column.column > 5 ||
      columns.has(column.column) ||
      typeof column.occupancy !== "string" ||
      !["Has Courses", "Empty Column"].includes(column.occupancy)
    )
      throw new RecognitionError("invalid_columns");
    columns.set(column.column, String(column.occupancy));
  }
  const cells = scratch.cells.map((c) => meeting(c, true));
  const identities = (meetings: Meeting[]) =>
    new Set(
      meetings.flatMap((row) =>
        row.periods.map((code) =>
          JSON.stringify([row.name.toLowerCase(), row.day, code]),
        ),
      ),
    );
  const fromCells = identities(cells),
    fromCourses = identities(rows);
  if (
    fromCells.size !== fromCourses.size ||
    [...fromCells].some((key) => !fromCourses.has(key))
  )
    throw new RecognitionError("inconsistent_columns");
  for (const [day, occupancy] of columns) {
    if ((occupancy === "Has Courses") !== cells.some((c) => c.day === day))
      throw new RecognitionError("inconsistent_columns", { day });
  }
  if (!rows.length) throw new RecognitionError("empty_result");
  return groupedCourses(rows);
}

type Atom = { code: string; room: string; day: number };
function periodIndex(code: string) {
  return /^[A-J]$/.test(code) ? code.charCodeAt(0) - 65 : Number(code);
}
function periodKind(code: string) {
  return /^[A-J]$/.test(code) ? "letter" : "number";
}
function groupedCourses(rows: Meeting[]): Course[] {
  const groups = new Map<string, { name: string; atoms: Map<string, Atom> }>();
  for (const row of rows) {
    const key = row.name.toLowerCase();
    const group = groups.get(key) ?? {
      name: row.name,
      atoms: new Map<string, Atom>(),
    };
    for (const code of row.periods) {
      const atom = { code, room: row.room, day: row.day };
      group.atoms.set(JSON.stringify(atom), atom);
    }
    groups.set(key, group);
  }
  return [...groups.values()]
    .map((group) => {
      const atoms = [...group.atoms.values()];
      for (let i = 0; i < atoms.length; i++)
        for (let j = i + 1; j < atoms.length; j++) {
          const a = atoms[i],
            b = atoms[j],
            left = TIME_MAP[a.code],
            right = TIME_MAP[b.code];
          if (
            a.day !== b.day ||
            left.start >= right.end ||
            right.start >= left.end
          )
            continue;
          const details = { course: group.name.slice(0, 100), day: a.day };
          if (periodKind(a.code) !== periodKind(b.code))
            throw new RecognitionError("period_conflict", details);
          if (a.room && b.room && a.room !== b.room)
            throw new RecognitionError("room_conflict", details);
        }
      const partitions = new Map<string, Atom[]>();
      for (const atom of group.atoms.values()) {
        const key = JSON.stringify([
          atom.day,
          atom.room,
          periodKind(atom.code),
        ]);
        const partition = partitions.get(key) ?? [];
        partition.push(atom);
        partitions.set(key, partition);
      }
      const slots: CourseSlot[] = [];
      for (const partition of partitions.values()) {
        partition.sort((a, b) => periodIndex(a.code) - periodIndex(b.code));
        let lastIndex = -100,
          lastSlot: CourseSlot | undefined;
        for (const atom of partition) {
          const times = TIME_MAP[atom.code],
            index = periodIndex(atom.code);
          if (lastSlot && index === lastIndex + 1) {
            lastSlot.endTime = times.end;
          } else {
            lastSlot = {
              weekday: WEEKDAYS[atom.day - 1],
              startTime: times.start,
              endTime: times.end,
              location: atom.room,
            };
            slots.push(lastSlot);
          }
          lastIndex = index;
        }
      }
      slots.sort(
        (a, b) =>
          WEEKDAYS.indexOf(a.weekday) - WEEKDAYS.indexOf(b.weekday) ||
          a.startTime.localeCompare(b.startTime) ||
          a.location.localeCompare(b.location),
      );
      return { name: group.name, professor: "", slots };
    })
    .sort(
      (a, b) =>
        WEEKDAYS.indexOf(a.slots[0].weekday) -
          WEEKDAYS.indexOf(b.slots[0].weekday) ||
        (a.name < b.name ? -1 : a.name > b.name ? 1 : 0),
    );
}
function modelFailure(error: unknown): RecognitionError {
  if (error instanceof RecognitionError) return error;
  const name = error instanceof Error ? error.name : "";
  if (
    [
      "ModelUnavailableError",
      "AuthenticationError",
      "PermissionDeniedError",
    ].includes(name)
  )
    return new RecognitionError("model_unavailable");
  if (
    ["AbortError", "TimeoutError", "APIConnectionTimeoutError"].includes(name)
  )
    return new RecognitionError("model_timeout");
  return new RecognitionError("model_failed");
}
function deadline<T>(
  work: Promise<T>,
  ms: number,
  failure: RecognitionError,
): Promise<T> {
  let timer: ReturnType<typeof setTimeout>;
  return Promise.race([
    work,
    new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(failure), ms);
    }),
  ]).finally(() => clearTimeout(timer));
}
export function createScheduleRecognizer(dependencies: Dependencies) {
  return async (
    image: ScheduleImage,
    context: RecognitionContext,
  ): Promise<Course[]> => {
    const started = Date.now();
    let reply: ModelReply | undefined,
      courses: Course[] = [],
      failure: RecognitionError | undefined;
    try {
      reply = await deadline(
        dependencies.model({ ...image, signal: AbortSignal.timeout(45000) }),
        45000,
        new RecognitionError("model_timeout"),
      );
      if (!reply.content) throw new RecognitionError("invalid_response");
      let payload: unknown;
      try {
        payload = JSON.parse(reply.content);
      } catch {
        throw new RecognitionError("invalid_response");
      }
      courses = coursesFromPayload(payload);
    } catch (error) {
      failure = modelFailure(error);
    }
    const record: RecognitionRecord = {
      ...context,
      model: reply?.model || "gpt-4o",
      inputTokens: reply?.inputTokens ?? null,
      outputTokens: reply?.outputTokens ?? null,
      latencyMs: reply?.latencyMs ?? Date.now() - started,
      modelStatus: reply ? "responded" : "failed",
      normalizationStatus: failure ? "failed" : "succeeded",
      failureCode: failure?.code ?? null,
      courseCount: failure ? 0 : courses.length,
      eventCount: failure ? 0 : courses.reduce((n, c) => n + c.slots.length, 0),
    };
    try {
      await deadline(
        dependencies.record(record),
        15000,
        new RecognitionError("logging_failed"),
      );
    } catch {
      throw new RecognitionError("logging_failed");
    }
    if (failure) throw failure;
    return courses;
  };
}
export const parseScheduleImage = createScheduleRecognizer({
  model: readScheduleModel,
  record: logRecognitionUsage,
});
