import { NextRequest, NextResponse } from "next/server";
import {
  accountUsage,
  signedInAccount,
  accountFailure,
} from "@/lib/account-access";
import { coursesToIcs } from "@/lib/ics";
import {
  WEEKDAYS,
  type Course,
  type CourseSlot,
  type Weekday,
} from "@/lib/types";

function isWeekday(value: string): value is Weekday {
  return (WEEKDAYS as readonly string[]).includes(value);
}

function isSlot(value: unknown): value is CourseSlot {
  if (!value || typeof value !== "object") return false;
  const slot = value as CourseSlot;
  return (
    typeof slot.weekday === "string" &&
    isWeekday(slot.weekday) &&
    typeof slot.startTime === "string" &&
    typeof slot.endTime === "string" &&
    slot.startTime.length <= 8 &&
    slot.endTime.length <= 8 &&
    (slot.location === undefined ||
      (typeof slot.location === "string" && slot.location.length <= 200))
  );
}

function isCourseList(value: unknown): value is Course[] {
  if (!Array.isArray(value) || value.length === 0 || value.length > 40)
    return false;
  return value.every((item) => {
    if (!item || typeof item !== "object") return false;
    const course = item as Course;
    return (
      typeof course.name === "string" &&
      course.name.length > 0 &&
      course.name.length <= 200 &&
      (course.professor === undefined ||
        (typeof course.professor === "string" &&
          course.professor.length <= 200)) &&
      Array.isArray(course.slots) &&
      course.slots.length <= 21 &&
      course.slots.every(isSlot)
    );
  });
}

const ICS_HEADERS = {
  "Content-Type": "text/calendar; charset=utf-8",
  "Content-Disposition": 'attachment; filename="course-schedule.ics"',
  "Cache-Control": "no-store",
};

async function readExportPayload(
  request: NextRequest,
): Promise<{ courses: unknown; token: string | null }> {
  const packed = new URL(request.url).searchParams.get("d");
  if (packed) {
    const parsed = JSON.parse(packed) as { courses?: unknown; token?: unknown };
    return {
      courses: parsed.courses,
      token: typeof parsed.token === "string" ? parsed.token : null,
    };
  }

  const contentType = request.headers.get("content-type") ?? "";
  if (contentType.includes("application/json")) {
    const body = (await request.json()) as {
      courses?: unknown;
      token?: unknown;
    };
    return {
      courses: body.courses,
      token: typeof body.token === "string" ? body.token : null,
    };
  }

  if (
    contentType.includes("application/x-www-form-urlencoded") ||
    contentType.includes("multipart/form-data")
  ) {
    const form = await request.formData();
    const raw = form.get("payload");
    if (typeof raw === "string" && raw) {
      const parsed = JSON.parse(raw) as { courses?: unknown; token?: unknown };
      return {
        courses: parsed.courses,
        token: typeof parsed.token === "string" ? parsed.token : null,
      };
    }
  }

  return { courses: undefined, token: null };
}

async function exportIcs(request: NextRequest) {
  let id: string;
  try {
    id = await signedInAccount();
  } catch (e) {
    return accountFailure(e);
  }
  let payload: { courses: unknown; token: string | null };
  try {
    payload = await readExportPayload(request);
  } catch {
    return NextResponse.json(
      { error: "Missing course list." },
      { status: 400 },
    );
  }

  try {
    if (!(await accountUsage(id)).canExportIcs)
      return NextResponse.json(
        { error: "取得匯出資格後即可下載行事曆。", requiresPayment: true },
        { status: 402 },
      );
  } catch (e) {
    return accountFailure(e);
  }

  if (!isCourseList(payload.courses)) {
    return NextResponse.json(
      { error: "Course list is invalid." },
      { status: 400 },
    );
  }

  try {
    return new NextResponse(coursesToIcs(payload.courses), {
      status: 200,
      headers: ICS_HEADERS,
    });
  } catch {
    return NextResponse.json(
      { error: "Could not build the calendar file." },
      { status: 400 },
    );
  }
}

export async function GET(request: NextRequest) {
  return exportIcs(request);
}

export async function POST(request: NextRequest) {
  return exportIcs(request);
}
