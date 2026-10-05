import { NextRequest, NextResponse } from "next/server";
import { readEntitlement, withAccountId } from "@/lib/entitlement";
import { coursesToIcs } from "@/lib/ics";
import { getGoogleSession } from "@/lib/session";
import { WEEKDAYS, type Course, type CourseSlot, type Weekday } from "@/lib/types";

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
    (slot.location === undefined || (typeof slot.location === "string" && slot.location.length <= 200))
  );
}

function isCourseList(value: unknown): value is Course[] {
  if (!Array.isArray(value) || value.length === 0 || value.length > 40) return false;
  return value.every((item) => {
    if (!item || typeof item !== "object") return false;
    const course = item as Course;
    return (
      typeof course.name === "string" &&
      course.name.length > 0 &&
      course.name.length <= 200 &&
      (course.professor === undefined ||
        (typeof course.professor === "string" && course.professor.length <= 200)) &&
      Array.isArray(course.slots) &&
      course.slots.length <= 21 &&
      course.slots.every(isSlot)
    );
  });
}

export async function POST(request: NextRequest) {
  const session = await getGoogleSession();
  if (!session?.user) {
    return NextResponse.json(
      { error: "Sign in with Google to download a calendar.", requiresAuth: true },
      { status: 401 },
    );
  }

  const googleId = session.user.id || session.user.email || "";
  let entitlement = readEntitlement(request);
  if (googleId) entitlement = withAccountId(entitlement, googleId);
  if (!entitlement.paid) {
    return NextResponse.json(
      { error: "Unlock the paid plan to download an .ics calendar.", requiresPayment: true },
      { status: 402 },
    );
  }

  let body: { courses?: unknown };
  try {
    body = (await request.json()) as { courses?: unknown };
  } catch {
    return NextResponse.json({ error: "Missing course list." }, { status: 400 });
  }
  if (!isCourseList(body.courses)) {
    return NextResponse.json({ error: "Course list is invalid." }, { status: 400 });
  }

  try {
    const ics = coursesToIcs(body.courses);
    return new NextResponse(ics, {
      status: 200,
      headers: {
        "Content-Type": "text/calendar; charset=utf-8",
        "Content-Disposition": 'attachment; filename="course-schedule.ics"',
        "Cache-Control": "no-store",
      },
    });
  } catch {
    return NextResponse.json({ error: "Could not build the calendar file." }, { status: 400 });
  }
}
