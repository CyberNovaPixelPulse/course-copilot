import OpenAI from "openai";
import type { ScheduleImage, ModelReply } from "./parse-schedule";

const OPENAI_TIMEOUT_MS = 45_000;
const IMAGE_DETAIL = "high" as const;

const COLUMN_NOTE = {
  type: "object",
  additionalProperties: false,
  required: ["column", "occupancy"],
  properties: {
    column: { type: "integer", minimum: 1, maximum: 5 },
    occupancy: { type: "string", enum: ["Has Courses", "Empty Column"] },
  },
} as const;

const CELL_NOTE = {
  type: "object",
  additionalProperties: false,
  required: ["name", "column", "codes"],
  properties: {
    name: { type: "string" },
    column: { type: "integer", minimum: 1, maximum: 5 },
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
          day: { type: "integer", minimum: 1, maximum: 5 },
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
    const error = new Error("Model configuration unavailable");
    error.name = "ModelUnavailableError";
    throw error;
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

export async function readScheduleModel(
  params: ScheduleImage & { signal: AbortSignal },
): Promise<ModelReply> {
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

  return {
    content: completion.choices[0]?.message?.content ?? "",
    model: completion.model || "gpt-4o",
    inputTokens: completion.usage?.prompt_tokens ?? null,
    outputTokens: completion.usage?.completion_tokens ?? null,
    latencyMs: Date.now() - started,
  };
}
