import { WEEKDAYS, type Course, type CourseSlot, type Weekday } from "./types";

export function parseMinutes(value: string): number | null {
  const match = value.trim().match(/^(\d{1,2}):(\d{2})$/);
  if (!match) return null;
  const h = Number(match[1]),
    m = Number(match[2]);
  return h < 24 && m < 60 ? h * 60 + m : null;
}
export function formatMinutes(value: number): string {
  return `${String(Math.floor(value / 60)).padStart(2, "0")}:${String(value % 60).padStart(2, "0")}`;
}
export function slotProblem(slot: CourseSlot): string | null {
  if (!WEEKDAYS.includes(slot.weekday)) return "星期無效";
  const start = parseMinutes(slot.startTime),
    end = parseMinutes(slot.endTime);
  if (start === null || end === null)
    return "請輸入 00:00–23:59 的時間（例如 07:10）";
  if (end <= start) return "結束時間須晚於開始時間，且必須在同一天";
  return null;
}
export function normalizeSlot(
  slot: CourseSlot,
): { slot: CourseSlot; problem: null } | { slot: null; problem: string } {
  const problem = slotProblem(slot);
  if (problem) return { slot: null, problem };
  return {
    slot: {
      ...slot,
      startTime: formatMinutes(parseMinutes(slot.startTime)!),
      endTime: formatMinutes(parseMinutes(slot.endTime)!),
    },
    problem: null,
  };
}
export type TimeWindow = { start: number; end: number };
export type SlotProblem = {
  courseIndex: number;
  slotIndex: number;
  message: string;
};
export function inspectSchedule(courses: Course[]) {
  const problems: SlotProblem[] = [];
  let start = 480,
    end = 1320;
  const normalized = courses.map((course, courseIndex) => {
    if (!course.slots.length)
      problems.push({
        courseIndex,
        slotIndex: -1,
        message: "課程沒有上課時段",
      });
    return {
      ...course,
      slots: course.slots.map((slot, slotIndex) => {
        const normalized = normalizeSlot(slot);
        if (!normalized.slot) {
          problems.push({
            courseIndex,
            slotIndex,
            message: normalized.problem,
          });
          return { ...slot };
        }
        const s = parseMinutes(slot.startTime)!,
          e = parseMinutes(slot.endTime)!;
        start = Math.min(start, Math.floor(s / 60) * 60);
        end = Math.max(end, Math.ceil(e / 60) * 60);
        return normalized.slot;
      }),
    };
  });
  const days: Weekday[] = normalized.some((c) =>
    c.slots.some(
      (s) =>
        !slotProblem(s) && (s.weekday === "Saturday" || s.weekday === "Sunday"),
    ),
  )
    ? [...WEEKDAYS]
    : WEEKDAYS.slice(0, 5);
  return { courses: normalized, problems, window: { start, end }, days };
}

/** Delta is measured from the original slot, not the last rendered preview. */
export function changeSlotTime(
  slot: CourseSlot,
  kind: "move" | "start" | "end",
  delta: number,
  window: TimeWindow,
): CourseSlot {
  if (slotProblem(slot)) return { ...slot };
  let start = parseMinutes(slot.startTime)!,
    end = parseMinutes(slot.endTime)!;
  const step = Math.round(delta / 15) * 15;
  const min = Math.max(0, window.start),
    max = Math.min(1439, window.end);
  if (kind === "move") {
    const shift = Math.max(min - start, Math.min(step, max - end));
    start += shift;
    end += shift;
  } else if (kind === "start")
    start = Math.max(min, Math.min(start + step, end - 1));
  else end = Math.min(max, Math.max(end + step, start + 1));
  return {
    ...slot,
    startTime: formatMinutes(start),
    endTime: formatMinutes(end),
  };
}

export function overlappingSlots(courses: Course[]) {
  const slots = courses
    .flatMap((c, courseIndex) =>
      c.slots.map((slot, slotIndex) => ({ slot, courseIndex, slotIndex })),
    )
    .filter((s) => !slotProblem(s.slot));
  const pairs: {
    first: { courseIndex: number; slotIndex: number };
    second: { courseIndex: number; slotIndex: number };
  }[] = [];
  slots.forEach((a, i) =>
    slots.slice(i + 1).forEach((b) => {
      if (
        a.slot.weekday === b.slot.weekday &&
        parseMinutes(a.slot.startTime)! < parseMinutes(b.slot.endTime)! &&
        parseMinutes(b.slot.startTime)! < parseMinutes(a.slot.endTime)!
      )
        pairs.push({
          first: { courseIndex: a.courseIndex, slotIndex: a.slotIndex },
          second: { courseIndex: b.courseIndex, slotIndex: b.slotIndex },
        });
    }),
  );
  return pairs;
}

/** Structural safety deliberately permits invalid day/time values for repair. */
export function isCourseStructure(value: unknown): value is Course[] {
  return (
    Array.isArray(value) &&
    value.every(
      (c) =>
        c &&
        typeof c.name === "string" &&
        typeof c.professor === "string" &&
        Array.isArray(c.slots) &&
        c.slots.every(
          (s: Record<string, unknown>) =>
            s &&
            typeof s.weekday === "string" &&
            typeof s.startTime === "string" &&
            typeof s.endTime === "string" &&
            typeof s.location === "string",
        ),
    )
  );
}
export function exportableCourses(value: unknown): Course[] {
  if (!isCourseStructure(value)) throw new Error("課表結構無法辨認，無法載入");
  if (!value.length) throw new Error("尚無可輸出的課程");
  const result = inspectSchedule(value);
  if (result.problems.length)
    throw new Error(
      result.problems
        .map((p) => `${value[p.courseIndex].name}：${p.message}`)
        .join("；"),
    );
  return result.courses;
}

export function placeTimeRanges<T extends { start: number; end: number }>(
  events: T[],
): (T & { col: number; cols: number })[] {
  const sorted = [...events].sort((a, b) => a.start - b.start || a.end - b.end);
  const clusters: T[][] = [];

  for (const event of sorted) {
    const cluster = clusters[clusters.length - 1];
    if (!cluster) {
      clusters.push([event]);
      continue;
    }
    const clusterEnd = Math.max(...cluster.map((item) => item.end));
    if (event.start < clusterEnd) cluster.push(event);
    else clusters.push([event]);
  }

  return clusters.flatMap((cluster) => {
    const colEnd: number[] = [];
    const placed = cluster.map((event) => {
      let col = colEnd.findIndex((end) => end <= event.start);
      if (col === -1) {
        col = colEnd.length;
        colEnd.push(event.end);
      } else {
        colEnd[col] = event.end;
      }
      return { ...event, col };
    });
    const cols = Math.max(colEnd.length, 1);
    return placed.map((event) => ({ ...event, cols }));
  });
}
