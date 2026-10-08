import OpenAI from "openai";
import { WEEKDAYS, type Course, type CourseSlot, type Weekday } from "./types";

export type PeriodTime = {
  label: string;
  startTime: string;
  endTime: string;
};

const COURSE_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["courses"],
  properties: {
    courses: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["name", "day", "start", "end", "room"],
        properties: {
          name: { type: "string" },
          day: { type: "integer" },
          start: { type: "string" },
          end: { type: "string" },
          room: { type: "string" },
        },
      },
    },
  },
} as const;

export type VisionModel = "gpt-4o" | "gpt-4o-mini";

const COURSE_PROMPT = `Return only the JSON object. No explanation.
Each class meeting is one object with only name, day, start, end, room.
day: 1 Monday, 2 Tuesday, 3 Wednesday, 4 Thursday, 5 Friday, 6 Saturday, 7 Sunday.
start and end are HH:mm copied from the image. Do not round.
room is the classroom, or "".
{"courses":[{"name":"","day":1,"start":"08:10","end":"09:00","room":""}]}`;

const MAX_PERIOD_GAP_MINUTES = 20;

function isClockTime(value: string) {
  return /^([01]\d|2[0-3]):[0-5]\d$/.test(value);
}

function timeToMinutes(value: string) {
  if (!isClockTime(value)) return null;
  const [hours, minutes] = value.split(":").map(Number);
  return hours * 60 + minutes;
}

function normalizeTime(value: unknown): string {
  if (typeof value !== "string") return "";
  const trimmed = value.trim();
  if (/^[A-J]$/i.test(trimmed) || /^(第?\d{1,2}\s*節?)$/.test(trimmed)) {
    return "";
  }
  const match = trimmed.match(/^(\d{1,2})[:：.](\d{2})(?:\s*(AM|PM|am|pm))?$/);
  if (!match) return "";
  let hours = Number(match[1]);
  const minutes = match[2];
  const meridiem = match[3]?.toUpperCase();
  if (meridiem === "PM" && hours < 12) hours += 12;
  if (meridiem === "AM" && hours === 12) hours = 0;
  if (hours > 23) return "";
  const clock = `${String(hours).padStart(2, "0")}:${minutes}`;
  return isClockTime(clock) ? clock : "";
}

function weekdayFromDay(value: unknown): Weekday | null {
  if (typeof value === "number" && Number.isInteger(value) && value >= 1 && value <= 7) {
    return WEEKDAYS[value - 1];
  }
  if (typeof value === "string" && /^[1-7]$/.test(value.trim())) {
    return WEEKDAYS[Number(value.trim()) - 1];
  }
  return normalizeWeekday(value);
}

function normalizeWeekday(value: unknown): Weekday | null {
  if (typeof value !== "string") return null;
  const raw = value.trim();
  const direct = WEEKDAYS.find((day) => day.toLowerCase() === raw.toLowerCase());
  if (direct) return direct;

  const aliases: Record<string, Weekday> = {
    mon: "Monday",
    m: "Monday",
    tue: "Tuesday",
    tues: "Tuesday",
    t: "Tuesday",
    wed: "Wednesday",
    w: "Wednesday",
    thu: "Thursday",
    thur: "Thursday",
    thurs: "Thursday",
    th: "Thursday",
    r: "Thursday",
    fri: "Friday",
    f: "Friday",
    sat: "Saturday",
    sun: "Sunday",
    "週一": "Monday",
    "周一": "Monday",
    "星期一": "Monday",
    一: "Monday",
    "週二": "Tuesday",
    "周二": "Tuesday",
    "星期二": "Tuesday",
    二: "Tuesday",
    "週三": "Wednesday",
    "周三": "Wednesday",
    "星期三": "Wednesday",
    三: "Wednesday",
    "週四": "Thursday",
    "周四": "Thursday",
    "星期四": "Thursday",
    四: "Thursday",
    "週五": "Friday",
    "周五": "Friday",
    "星期五": "Friday",
    五: "Friday",
    "週六": "Saturday",
    "周六": "Saturday",
    "星期六": "Saturday",
    六: "Saturday",
    "週日": "Sunday",
    "周日": "Sunday",
    "星期日": "Sunday",
    "星期天": "Sunday",
    日: "Sunday",
  };
  return aliases[raw] ?? aliases[raw.toLowerCase()] ?? null;
}

function openaiClient() {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    throw new Error("Missing OPENAI_API_KEY. Add it to .env.local.");
  }
  return new OpenAI({ apiKey });
}

function imagePart(mimeType: string, base64: string) {
  return {
    type: "image_url" as const,
    image_url: {
      url: `data:${mimeType};base64,${base64}`,
      detail: "high" as const,
    },
  };
}

async function parseJsonContent(content: string | null | undefined) {
  if (!content) {
    throw new Error("The model returned an empty response.");
  }
  try {
    return JSON.parse(content) as unknown;
  } catch {
    throw new Error("The model returned invalid JSON.");
  }
}

function meetingFromRow(row: Record<string, unknown>): CourseSlot | null {
  const weekday = weekdayFromDay(row.day ?? row.weekday);
  if (!weekday) return null;
  const startTime = normalizeTime(row.start ?? row.startTime);
  const endTime = normalizeTime(row.end ?? row.endTime);
  if (!startTime || !endTime) return null;
  const room = row.room ?? row.location;
  return {
    weekday,
    startTime,
    endTime,
    location: typeof room === "string" ? room.trim() : "",
  };
}

function courseKey(name: string) {
  return name.replace(/\s+/g, " ").trim().toLowerCase();
}

function mergeCourses(courses: Course[]): Course[] {
  const grouped = new Map<string, Course>();

  for (const course of courses) {
    const key = courseKey(course.name);
    const slots = Array.isArray(course.slots) ? course.slots : [];
    const existing = grouped.get(key);
    if (!existing) {
      grouped.set(key, {
        name: course.name.trim(),
        professor: course.professor,
        slots: [...slots],
      });
      continue;
    }
    if (!existing.professor && course.professor) {
      existing.professor = course.professor;
    }
    existing.slots.push(...slots);
  }

  return [...grouped.values()].map((course) => ({
    ...course,
    slots: mergeConsecutiveSlots(
      (course.slots || []).filter(
        (slot, index, all) =>
          all.findIndex(
            (other) =>
              other.weekday === slot.weekday &&
              other.startTime === slot.startTime &&
              other.endTime === slot.endTime &&
              other.location === slot.location,
          ) === index,
      ),
    ),
  }));
}

function mergeConsecutiveSlots(slots: CourseSlot[]): CourseSlot[] {
  const merged: CourseSlot[] = [];

  for (const weekday of WEEKDAYS) {
    const daySlots = slots
      .filter((slot) => slot.weekday === weekday)
      .sort((a, b) => (timeToMinutes(a.startTime) ?? 0) - (timeToMinutes(b.startTime) ?? 0));

    let current: CourseSlot | null = null;
    for (const slot of daySlots) {
      const start = timeToMinutes(slot.startTime);
      const end = timeToMinutes(slot.endTime);
      if (start === null || end === null) continue;

      if (!current) {
        current = { ...slot };
        continue;
      }

      const currentEnd = timeToMinutes(current.endTime);
      if (currentEnd !== null && start <= currentEnd + MAX_PERIOD_GAP_MINUTES) {
        if (end > currentEnd) current.endTime = slot.endTime;
        if (!current.location && slot.location) current.location = slot.location;
        continue;
      }

      merged.push(current);
      current = { ...slot };
    }

    if (current) merged.push(current);
  }

  return merged;
}

export function normalizeCourses(payload: unknown): Course[] {
  const root =
    payload && typeof payload === "object" && "courses" in payload
      ? (payload as { courses: unknown }).courses
      : payload;
  if (!Array.isArray(root)) return [];

  const courses = root.flatMap((item) => {
    if (!item || typeof item !== "object") return [];
    const row = item as Record<string, unknown>;
    const name = typeof row.name === "string" ? row.name.trim() : "";
    if (!name) return [];
    const meeting = meetingFromRow(row);
    if (!meeting) return [];
    return [{ name, professor: "", slots: [meeting] }];
  });

  return mergeCourses(courses).map((course) => ({
    ...course,
    slots: Array.isArray(course.slots) ? course.slots : [],
  }));
}

export type AiCallMetric = {
  model: string;
  inputTokens: number;
  outputTokens: number;
  latencyMs: number;
  stage: string;
};

function metricFrom(
  completion: {
    model?: string;
    usage?: { prompt_tokens?: number; completion_tokens?: number } | null;
  },
  started: number,
  stage: string,
): AiCallMetric {
  return {
    model: completion.model || "gpt-4o",
    inputTokens: completion.usage?.prompt_tokens ?? 0,
    outputTokens: completion.usage?.completion_tokens ?? 0,
    latencyMs: Date.now() - started,
    stage,
  };
}

export async function extractScheduleCourses(params: {
  mimeType: string;
  base64: string;
}): Promise<{ courses: Course[]; call: AiCallMetric }> {
  console.log("Currently using model:", "gpt-4o");
  const openai = openaiClient();
  const started = Date.now();
  const completion = await openai.chat.completions.create({
    model: "gpt-4o",
    temperature: 0,
    response_format: {
      type: "json_schema",
      json_schema: {
        name: "course_schedule",
        strict: true,
        schema: COURSE_SCHEMA,
      },
    },
    messages: [
      { role: "system", content: COURSE_PROMPT },
      {
        role: "user",
        content: [
          { type: "text", text: "Extract the courses." },
          imagePart(params.mimeType, params.base64),
        ],
      },
    ],
  });

  return {
    courses: normalizeCourses(await parseJsonContent(completion.choices[0]?.message?.content)),
    call: metricFrom(completion, started, "courses"),
  };
}

export async function parseScheduleImage(params: {
  mimeType: string;
  base64: string;
  model?: VisionModel;
}): Promise<{ courses: Course[]; periods: PeriodTime[]; calls: AiCallMetric[] }> {
  const calls: AiCallMetric[] = [];
  try {
    const parsed = await extractScheduleCourses(params);
    calls.push(parsed.call);
    return { courses: parsed.courses, periods: [], calls };
  } catch (error) {
    if (error && typeof error === "object") {
      (error as { aiCalls?: AiCallMetric[] }).aiCalls = calls;
    }
    throw error;
  }
}
