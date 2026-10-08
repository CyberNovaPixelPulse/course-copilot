import OpenAI from "openai";
import { WEEKDAYS, type Course, type CourseSlot, type Weekday } from "./types";

export type PeriodTime = {
  label: string;
  startTime: string;
  endTime: string;
};

const PERIOD_MAP_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["periods"],
  properties: {
    periods: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["label", "startTime", "endTime"],
        properties: {
          label: { type: "string" },
          startTime: { type: "string", description: 'Exact HH:mm from the header, e.g. "08:45"' },
          endTime: { type: "string", description: 'Exact HH:mm from the header, e.g. "09:35"' },
        },
      },
    },
  },
} as const;

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
        required: ["name", "professor", "slots"],
        properties: {
          name: { type: "string" },
          professor: { type: "string" },
          slots: {
            type: "array",
            items: {
              type: "object",
              additionalProperties: false,
              required: ["weekday", "startTime", "endTime", "location", "periodLabels"],
              properties: {
                weekday: { type: "string", enum: [...WEEKDAYS] },
                startTime: {
                  type: "string",
                  description: "HH:mm copied from the provided period time map",
                },
                endTime: {
                  type: "string",
                  description: "HH:mm copied from the provided period time map",
                },
                location: { type: "string" },
                periodLabels: {
                  type: "array",
                  items: { type: "string" },
                  description: 'Header labels this block occupies, e.g. ["1","2"] or ["A"]',
                },
              },
            },
          },
        },
      },
    },
  },
} as const;

export type VisionModel = "gpt-4o" | "gpt-4o-mini";

const STAGE1_PROMPT = `You read timetable HEADERS only. Ignore course names.

Find period labels (1, 2, A, 第1節) and the exact clock times printed next to them (often a second header row), e.g. 1 → 08:45–09:35.

Copy startTime and endTime exactly as HH:mm. Do not round times.

Return JSON: { "periods": [{ "label", "startTime", "endTime" }] }.`;

function stage2Prompt(periodMapText: string) {
  return `Extract every course from this schedule image as structured JSON.

Use this period → time map (copy these times; do not guess or round):
${periodMapText}

For each class output:
- name
- professor (empty string if unknown)
- slots: weekday, startTime, endTime, location, periodLabels

Weekday must be one of: Monday, Tuesday, Wednesday, Thursday, Friday, Saturday, Sunday.
startTime and endTime must be HH:mm from the map above.
periodLabels lists the header periods the block occupies, e.g. ["1","2"].
Group the same course name into one object with multiple slots.
Do not invent classes.

Return JSON: { "courses": [{ "name", "professor", "slots": [{ "weekday", "startTime", "endTime", "location", "periodLabels" }] }] }.`;
}

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

function labelKeys(label: string) {
  const trimmed = label.trim();
  const keys = new Set<string>([trimmed, trimmed.toLowerCase()]);
  const numeric = trimmed.match(/(\d{1,2})/);
  if (numeric) {
    keys.add(numeric[1]);
    keys.add(`period ${numeric[1]}`);
    keys.add(`第${numeric[1]}節`);
  }
  const letter = trimmed.match(/\b([A-J])\b/i);
  if (letter) keys.add(letter[1].toUpperCase());
  return [...keys];
}

export function buildPeriodLookup(periods: PeriodTime[]) {
  const map = new Map<string, PeriodTime>();
  for (const period of periods) {
    for (const key of labelKeys(period.label)) {
      map.set(key, period);
    }
  }
  return map;
}

function formatPeriodMap(periods: PeriodTime[]) {
  if (periods.length === 0) {
    return "(no header periods found — read clock digits from the image axis only; do not invent a standard timetable)";
  }
  return periods
    .map((period) => `- "${period.label}" → ${period.startTime}–${period.endTime}`)
    .join("\n");
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
    image_url: { url: `data:${mimeType};base64,${base64}` },
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

export function normalizePeriodMap(payload: unknown): PeriodTime[] {
  const root =
    payload && typeof payload === "object" && "periods" in payload
      ? (payload as { periods: unknown }).periods
      : payload;
  if (!Array.isArray(root)) return [];

  return root.flatMap((item) => {
    if (!item || typeof item !== "object") return [];
    const row = item as Record<string, unknown>;
    const label = typeof row.label === "string" ? row.label.trim() : "";
    const startTime = normalizeTime(row.startTime);
    const endTime = normalizeTime(row.endTime);
    if (!label || !startTime || !endTime) return [];
    return [{ label, startTime, endTime }];
  });
}

function normalizeSlot(
  row: Record<string, unknown>,
  lookup: Map<string, PeriodTime>,
): CourseSlot | null {
  const weekday = normalizeWeekday(row.weekday);
  if (!weekday) return null;

  const labels = Array.isArray(row.periodLabels)
    ? row.periodLabels.filter((label): label is string => typeof label === "string")
    : typeof row.periodLabel === "string"
      ? [row.periodLabel]
      : [];

  const resolved = labels
    .flatMap((label) => {
      const match = lookup.get(label.trim()) ?? lookup.get(label.trim().toLowerCase());
      const numeric = label.match(/(\d{1,2})/);
      const byNumber = numeric ? lookup.get(numeric[1]) : undefined;
      const found = match ?? byNumber;
      return found ? [found] : [];
    })
    .sort(
      (a, b) => (timeToMinutes(a.startTime) ?? 0) - (timeToMinutes(b.startTime) ?? 0),
    );

  const startTime = resolved[0]?.startTime || normalizeTime(row.startTime);
  const endTime =
    resolved[resolved.length - 1]?.endTime || normalizeTime(row.endTime);
  if (!startTime || !endTime) return null;

  return {
    weekday,
    startTime,
    endTime,
    location: typeof row.location === "string" ? row.location.trim() : "",
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

export function normalizeCourses(
  payload: unknown,
  periods: PeriodTime[] = [],
): Course[] {
  const lookup = buildPeriodLookup(periods);
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
    const professor = typeof row.professor === "string" ? row.professor.trim() : "";

    const fromSlots = Array.isArray(row.slots)
      ? row.slots.flatMap((slot) => {
          if (!slot || typeof slot !== "object") return [];
          const normalized = normalizeSlot(slot as Record<string, unknown>, lookup);
          return normalized ? [normalized] : [];
        })
      : [];

    const single = normalizeSlot(row, lookup);
    const slots = fromSlots.length > 0 ? fromSlots : single ? [single] : [];
    return [{ name, professor, slots }];
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

export async function extractScheduleTimeMap(params: {
  mimeType: string;
  base64: string;
  model?: VisionModel;
}): Promise<{ periods: PeriodTime[]; call: AiCallMetric }> {
  const modelName = params.model ?? "gpt-4o";
  console.log("Currently using model:", modelName);
  const openai = openaiClient();
  const started = Date.now();
  const completion = await openai.chat.completions.create({
    model: "gpt-4o",
    temperature: 0,
    response_format: {
      type: "json_schema",
      json_schema: {
        name: "period_time_map",
        strict: true,
        schema: PERIOD_MAP_SCHEMA,
      },
    },
    messages: [
      { role: "system", content: STAGE1_PROMPT },
      {
        role: "user",
        content: [
          {
            type: "text",
            text: "Extract the header period-label → exact clock-time map from this schedule. Copy times like 08:45 exactly; do not round to 08:10.",
          },
          imagePart(params.mimeType, params.base64),
        ],
      },
    ],
  });

  return {
    periods: normalizePeriodMap(await parseJsonContent(completion.choices[0]?.message?.content)),
    call: metricFrom(completion, started, "period-map"),
  };
}

export async function extractScheduleCourses(params: {
  mimeType: string;
  base64: string;
  periods: PeriodTime[];
  model?: VisionModel;
}): Promise<{ courses: Course[]; call: AiCallMetric }> {
  const modelName = params.model ?? "gpt-4o";
  console.log("Currently using model:", modelName);
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
      { role: "system", content: stage2Prompt(formatPeriodMap(params.periods)) },
      {
        role: "user",
        content: [
          {
            type: "text",
            text: "Map every course block to the Stage 1 period time map. Use those exact start/end times. Include periodLabels for each slot.",
          },
          imagePart(params.mimeType, params.base64),
        ],
      },
    ],
  });

  return {
    courses: normalizeCourses(
      await parseJsonContent(completion.choices[0]?.message?.content),
      params.periods,
    ),
    call: metricFrom(completion, started, "courses"),
  };
}

export async function parseScheduleImage(params: {
  mimeType: string;
  base64: string;
  model?: VisionModel;
}): Promise<{ courses: Course[]; periods: PeriodTime[]; calls: AiCallMetric[] }> {
  const model = params.model ?? "gpt-4o";
  const calls: AiCallMetric[] = [];
  try {
    const mapped = await extractScheduleTimeMap({ ...params, model });
    calls.push(mapped.call);
    const parsed = await extractScheduleCourses({ ...params, periods: mapped.periods, model });
    calls.push(parsed.call);
    return { courses: parsed.courses, periods: mapped.periods, calls };
  } catch (error) {
    if (error && typeof error === "object") {
      (error as { aiCalls?: AiCallMetric[] }).aiCalls = calls;
    }
    throw error;
  }
}
