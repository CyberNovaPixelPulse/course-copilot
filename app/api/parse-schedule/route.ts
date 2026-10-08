import { NextRequest, NextResponse } from "next/server";
import { parseScheduleImage, type AiCallMetric } from "@/lib/parse-schedule";
import { logAiUsage } from "@/lib/turso";
import {
  consumeFreeScan,
  freeScansRemaining,
  incrementParse,
  readEntitlement,
  toUsagePublic,
  attachEntitlement,
  withAccountId,
  withFreeScans,
} from "@/lib/entitlement";
import { getGoogleSession } from "@/lib/session";
import { WEEKDAYS, type Course, type CourseSlot } from "@/lib/types";

export const maxDuration = 120;

const ACCEPTED_TYPES = new Set(["image/png", "image/jpeg", "image/webp", "image/gif"]);
const MAX_BYTES = 15 * 1024 * 1024;
/** Break between consecutive periods, e.g. 09:35 then 09:45. */
const BACK_TO_BACK_GAP_MINUTES = 15;

function timeToMinutes(value: string) {
  const match = value.trim().match(/^(\d{1,2}):(\d{2})$/);
  if (!match) return null;
  return Number(match[1]) * 60 + Number(match[2]);
}

function dedupeSlots(slots: CourseSlot[]) {
  const seen = new Set<string>();
  const unique: CourseSlot[] = [];
  for (const slot of slots) {
    const key = `${slot.weekday}|${slot.startTime}|${slot.endTime}|${slot.location ?? ""}`;
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push(slot);
  }
  return unique;
}

function mergeSlotsOnWeekday(slots: CourseSlot[]) {
  const sorted = [...slots].sort(
    (a, b) => (timeToMinutes(a.startTime) ?? 0) - (timeToMinutes(b.startTime) ?? 0),
  );
  const merged: CourseSlot[] = [];

  for (const slot of sorted) {
    const start = timeToMinutes(slot.startTime);
    const end = timeToMinutes(slot.endTime);
    if (start === null || end === null) continue;

    const current = merged[merged.length - 1];
    const currentEnd = current ? timeToMinutes(current.endTime) : null;
    const isBackToBackOrOverlap =
      currentEnd !== null && start - currentEnd <= BACK_TO_BACK_GAP_MINUTES;

    if (current && isBackToBackOrOverlap) {
      if (end > currentEnd) current.endTime = slot.endTime;
      if (!current.location && slot.location) current.location = slot.location;
      continue;
    }

    merged.push({ ...slot });
  }

  return merged;
}

function mergeCourseSlots(course: Course): Course {
  const slots = dedupeSlots(Array.isArray(course.slots) ? course.slots : []);
  const byWeekday = new Map<string, CourseSlot[]>();

  for (const slot of slots) {
    const weekday = slot.weekday || "unknown";
    const list = byWeekday.get(weekday) ?? [];
    list.push(slot);
    byWeekday.set(weekday, list);
  }

  const merged: CourseSlot[] = [];
  const orderedDays = [
    ...WEEKDAYS.filter((day) => byWeekday.has(day)),
    ...[...byWeekday.keys()].filter(
      (day) => !(WEEKDAYS as readonly string[]).includes(day),
    ),
  ];

  for (const weekday of orderedDays) {
    merged.push(...mergeSlotsOnWeekday(byWeekday.get(weekday) ?? []));
  }

  return { ...course, slots: merged };
}

export async function POST(request: NextRequest) {
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

    const buffer = Buffer.from(await image.arrayBuffer());
    const imagePayload = {
      mimeType: image.type,
      base64: buffer.toString("base64"),
    };

    const parsedResult = await parseScheduleImage({
      ...imagePayload,
      model: "gpt-4o",
    });
    const courses = parsedResult.courses.map((course) =>
      mergeCourseSlots({
        ...course,
        slots: Array.isArray(course.slots) ? course.slots : [],
      }),
    );
    for (const call of parsedResult.calls) {
      logAiUsage({
        siteId: "course-copilot",
        model: call.model,
        inputTokens: call.inputTokens,
        outputTokens: call.outputTokens,
        latencyMs: call.latencyMs,
        status: "success",
        metadata: {
          stage: call.stage,
          mimeType: image.type,
          courseCount: courses.length,
          periodCount: parsedResult.periods.length,
          paid: entitlement.paid,
        },
      });
    }

    const next = entitlement.paid ? incrementParse(entitlement, "gpt-4o") : consumeFreeScan(entitlement);
    const usage = toUsagePublic(next, authenticated);
    const response = NextResponse.json({ courses, usage, model: "gpt-4o" });
    attachEntitlement(response, next);
    return response;
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Failed to parse the schedule image.";
    const calls =
      error && typeof error === "object" && Array.isArray((error as { aiCalls?: AiCallMetric[] }).aiCalls)
        ? (error as { aiCalls: AiCallMetric[] }).aiCalls
        : [];
    if (calls.length === 0) {
      logAiUsage({
        siteId: "course-copilot",
        model: "gpt-4o",
        inputTokens: 0,
        outputTokens: 0,
        latencyMs: 0,
        status: "error",
        metadata: { message },
      });
    } else {
      for (const call of calls) {
        logAiUsage({
          siteId: "course-copilot",
          model: call.model,
          inputTokens: call.inputTokens,
          outputTokens: call.outputTokens,
          latencyMs: call.latencyMs,
          status: "success",
          metadata: { stage: call.stage },
        });
      }
      logAiUsage({
        siteId: "course-copilot",
        model: "gpt-4o",
        inputTokens: 0,
        outputTokens: 0,
        latencyMs: 0,
        status: "error",
        metadata: { message, completedStages: calls.map((call) => call.stage) },
      });
    }
    const status = message.includes("OPENAI_API_KEY") ? 500 : 502;
    return NextResponse.json({ error: message }, { status });
  }
}
