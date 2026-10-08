import OpenAI from "openai";

export type PeriodTime = {
  label: string;
  startTime: string;
  endTime: string;
};

export type VisionModel = "gpt-4o" | "gpt-4o-mini";

export type ScheduleMeeting = {
  name: string;
  day: number;
  periods: string[];
  room: string;
  start: string;
  end: string;
};

const OPENAI_TIMEOUT_MS = 45_000;

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
        required: ["name", "day", "periods", "room", "start", "end"],
        properties: {
          name: { type: "string" },
          day: { type: "integer" },
          periods: { type: "array", items: { type: "string" } },
          room: { type: "string" },
          start: { type: "string" },
          end: { type: "string" },
        },
      },
    },
  },
} as const;

const COURSE_PROMPT = `Return only the JSON object.
Read five equal columns to the right of the left time margin.
day 1 is Monday, day 2 Tuesday, day 3 Wednesday, day 4 Thursday, day 5 Friday.
An empty column stays empty. Do not move a course into another day.
For each course return the printed period codes in periods, such as ["B"] or ["8","9"] or ["C","D"].
Leave start and end as "" when a code from 1-15 or A-J is present.
Only when the sheet has none of those codes, copy the printed start and end exactly. 08:10 stays "08:10" and 07:10 stays "07:10".
name omits markers such as (B) or (8). room is the classroom, or "".
One object per course per day.`;

function openaiClient() {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    throw new Error("Missing OPENAI_API_KEY. Add it to .env.local.");
  }
  return new OpenAI({ apiKey, timeout: OPENAI_TIMEOUT_MS, maxRetries: 0 });
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

function textOf(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

export function meetingsFromPayload(payload: unknown): ScheduleMeeting[] {
  const root =
    payload && typeof payload === "object" && "courses" in payload
      ? (payload as { courses: unknown }).courses
      : null;
  if (!Array.isArray(root)) return [];

  const meetings: ScheduleMeeting[] = [];
  for (const item of root) {
    if (!item || typeof item !== "object") continue;
    const row = item as Record<string, unknown>;
    const day = typeof row.day === "number" ? row.day : Number(row.day);
    if (!Number.isInteger(day) || day < 1 || day > 7) continue;
    const periods = Array.isArray(row.periods) ? row.periods.map(textOf).filter(Boolean) : [];
    const name = textOf(row.name);
    if (!name) continue;
    meetings.push({
      name,
      day,
      periods,
      room: textOf(row.room),
      start: textOf(row.start),
      end: textOf(row.end),
    });
  }
  return meetings;
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
  signal?: AbortSignal;
}): Promise<{ meetings: ScheduleMeeting[]; call: AiCallMetric }> {
  if (!params.base64) {
    throw new Error("The uploaded image was empty.");
  }
  console.log("Currently using model:", "gpt-4o");
  console.log("OpenAI image payload bytes:", params.base64.length);
  const openai = openaiClient();
  const started = Date.now();
  const completion = await openai.chat.completions.create(
    {
      model: "gpt-4o",
      temperature: 0,
      response_format: {
        type: "json_schema",
        json_schema: {
          name: "period_codes",
          strict: true,
          schema: COURSE_SCHEMA,
        },
      },
      messages: [
        { role: "system", content: COURSE_PROMPT },
        {
          role: "user",
          content: [
            {
              type: "text",
              text: "Return day 1-5 and period codes. Put consecutive periods of the same course in one periods array. Copy a printed 08:10 as 08:10.",
            },
            imagePart(params.mimeType || "image/jpeg", params.base64),
          ],
        },
      ],
    },
    { timeout: OPENAI_TIMEOUT_MS, maxRetries: 0, signal: params.signal },
  );

  const content = completion.choices[0]?.message?.content;
  if (!content) {
    throw new Error("The model returned an empty response.");
  }
  let payload: unknown;
  try {
    payload = JSON.parse(content) as unknown;
  } catch {
    throw new Error("The model returned invalid JSON.");
  }
  return {
    meetings: meetingsFromPayload(payload),
    call: metricFrom(completion, started, "courses"),
  };
}

export async function parseScheduleImage(params: {
  mimeType: string;
  base64: string;
  model?: VisionModel;
  signal?: AbortSignal;
}): Promise<{ meetings: ScheduleMeeting[]; periods: PeriodTime[]; calls: AiCallMetric[] }> {
  const calls: AiCallMetric[] = [];
  try {
    const parsed = await extractScheduleCourses(params);
    calls.push(parsed.call);
    return { meetings: parsed.meetings, periods: [], calls };
  } catch (error) {
    if (error && typeof error === "object") {
      (error as { aiCalls?: AiCallMetric[] }).aiCalls = calls;
    }
    throw error;
  }
}
