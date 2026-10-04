import { WEEKDAYS, type Course, type Weekday } from "./types";

const ICS_WEEKDAY: Record<Weekday, string> = {
  Monday: "MO",
  Tuesday: "TU",
  Wednesday: "WE",
  Thursday: "TH",
  Friday: "FR",
  Saturday: "SA",
  Sunday: "SU",
};

const JS_WEEKDAY: Record<Weekday, number> = {
  Sunday: 0,
  Monday: 1,
  Tuesday: 2,
  Wednesday: 3,
  Thursday: 4,
  Friday: 5,
  Saturday: 6,
};

const DEFAULT_WEEK_COUNT = 16;

function pad(value: number) {
  return String(value).padStart(2, "0");
}

function parseTime(value: string): { hours: number; minutes: number } {
  const match = value.trim().match(/^(\d{1,2}):(\d{2})$/);
  if (!match) {
    throw new Error(`Invalid time: ${value}`);
  }
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (hours > 23 || minutes > 59) {
    throw new Error(`Invalid time: ${value}`);
  }
  return { hours, minutes };
}

function formatLocalDateTime(date: Date) {
  return (
    `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}` +
    `T${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}`
  );
}

function formatUtcStamp(date: Date) {
  return (
    `${date.getUTCFullYear()}${pad(date.getUTCMonth() + 1)}${pad(date.getUTCDate())}` +
    `T${pad(date.getUTCHours())}${pad(date.getUTCMinutes())}${pad(date.getUTCSeconds())}Z`
  );
}

function nextOccurrence(weekday: Weekday, hours: number, minutes: number, from = new Date()) {
  const date = new Date(from.getFullYear(), from.getMonth(), from.getDate(), hours, minutes, 0, 0);
  const target = JS_WEEKDAY[weekday];
  const delta = (target - date.getDay() + 7) % 7;
  date.setDate(date.getDate() + delta);
  return date;
}

function escapeText(value: string) {
  return value
    .replace(/\\/g, "\\\\")
    .replace(/;/g, "\\;")
    .replace(/,/g, "\\,")
    .replace(/\r\n/g, "\\n")
    .replace(/\n/g, "\\n");
}

function foldLine(line: string) {
  const limit = 75;
  if (line.length <= limit) return line;
  const chunks: string[] = [];
  let remaining = line;
  chunks.push(remaining.slice(0, limit));
  remaining = remaining.slice(limit);
  while (remaining.length > 0) {
    chunks.push(` ${remaining.slice(0, limit - 1)}`);
    remaining = remaining.slice(limit - 1);
  }
  return chunks.join("\r\n");
}

function slug(value: string) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 40) || "course";
}

export function coursesToIcs(
  courses: Course[],
  options?: { weekCount?: number; from?: Date },
) {
  const weekCount = options?.weekCount ?? DEFAULT_WEEK_COUNT;
  const now = options?.from ?? new Date();
  const dtstamp = formatUtcStamp(now);

  const events = courses.flatMap((course, courseIndex) =>
    (course.slots || []).flatMap((slot, slotIndex) => {
      if (!WEEKDAYS.includes(slot.weekday)) return [];
      const start = parseTime(slot.startTime);
      const end = parseTime(slot.endTime);
      const dtStart = nextOccurrence(slot.weekday, start.hours, start.minutes, now);
      const dtEnd = nextOccurrence(slot.weekday, end.hours, end.minutes, now);
      if (dtEnd <= dtStart) {
        dtEnd.setDate(dtEnd.getDate() + 1);
      }

      const uid = `${slug(course.name)}-${slot.weekday}-${slot.startTime.replace(":", "")}-${courseIndex}-${slotIndex}@course-copilot`;
      const description = course.professor ? `Professor: ${course.professor}` : "";

      return [
        "BEGIN:VEVENT",
        `UID:${uid}`,
        `DTSTAMP:${dtstamp}`,
        `DTSTART:${formatLocalDateTime(dtStart)}`,
        `DTEND:${formatLocalDateTime(dtEnd)}`,
        `RRULE:FREQ=WEEKLY;COUNT=${weekCount}`,
        `SUMMARY:${escapeText(course.name)}`,
        slot.location ? `LOCATION:${escapeText(slot.location)}` : "",
        description ? `DESCRIPTION:${escapeText(description)}` : "",
        "END:VEVENT",
      ].filter(Boolean);
    }),
  );

  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Course Copilot//EN",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    "X-WR-CALNAME:Course Schedule",
    ...events,
    "END:VCALENDAR",
  ];

  return `${lines.map(foldLine).join("\r\n")}\r\n`;
}

