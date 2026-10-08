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
const IMAGE_DETAIL = "high" as const;

const COLUMN_NOTE = {
  type: "object",
  additionalProperties: false,
  required: ["column", "occupancy"],
  properties: {
    column: { type: "integer" },
    occupancy: { type: "string", enum: ["Has Courses", "Empty Column"] },
  },
} as const;

const CELL_NOTE = {
  type: "object",
  additionalProperties: false,
  required: ["name", "column", "codes"],
  properties: {
    name: { type: "string" },
    column: { type: "integer" },
    codes: { type: "array", items: { type: "string" } },
  },
} as const;

const COURSE_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["scratchpad", "courses"],
  properties: {
    scratchpad: {
      type: "object",
      additionalProperties: false,
      required: ["columns", "cells"],
      properties: {
        columns: {
          type: "array",
          minItems: 5,
          maxItems: 5,
          items: COLUMN_NOTE,
        },
        cells: {
          type: "array",
          items: CELL_NOTE,
        },
      },
    },
    courses: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["name", "day", "periods", "room"],
        properties: {
          name: { type: "string" },
          day: { type: "integer" },
          periods: { type: "array", items: { type: "string" } },
          room: { type: "string" },
        },
      },
    },
  },
} as const;

const COURSE_PROMPT = `Return one JSON object. Fill scratchpad completely, then fill courses from that scratchpad. Do not invent clock times.

After the left time column, split the remaining width into five equal strips:
0% to 20% is column 1 週一, 20% to 40% is column 2 週二, 40% to 60% is column 3 週三, 60% to 80% is column 4 週四, 80% to 100% is column 5 週五.
A blank strip is an empty column. Do not slide the strip on its right into a blank strip.

Step 1, scratchpad.columns. Five entries, column 1 through 5, in that order.
occupancy is "Has Courses" or "Empty Column".

Step 2, scratchpad.cells. For each occupied cell, record the course name, its column number, and the codes printed in that cell, such as "B", "C", "D", "8", or "9".
Do not write HH:mm here.

Then courses. day is that column number, from 1 to 5. periods is those codes.
Put consecutive codes of the same course in one periods array, such as ["C","D"] or ["8","9"].
name omits markers such as (B) or (8). room is the classroom, or "".
The server looks up every code. Do not calculate start or end.`;

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
      detail: IMAGE_DETAIL,
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
      start: "",
      end: "",
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
  console.log("OpenAI image detail:", IMAGE_DETAIL);
  console.log("OpenAI image payload bytes:", params.base64.length);
  const openai = openaiClient();
  const started = Date.now();
  const completion = await openai.chat.completions.create(
    {
      model: "gpt-4o",
      temperature: 0,
      top_p: 1e-6,
      seed: 42,
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
              text: "Fill scratchpad.columns 1 through 5 first. A blank strip is Empty Column. Do not slide a later strip left. Then list each course with its column and printed codes only. Do not estimate HH:mm.",
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
