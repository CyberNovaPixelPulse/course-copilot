"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { WEEKDAYS, type Course, type CourseSlot, type Weekday } from "@/lib/types";
import { useI18n } from "@/lib/i18n";

const DAY_START = 8 * 60;
const DAY_END = 20 * 60;
const SNAP = 15;
const MIN_DURATION = 15;
const HOUR_HEIGHT = 72;
const GRID_HEIGHT = ((DAY_END - DAY_START) / 60) * HOUR_HEIGHT;
const WEEKDAYS_MON_FRI: Weekday[] = [
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
];

const PALETTE = [
  { bg: "#4f46e5", bgSoft: "#eef2ff", text: "#eef2ff" },
  { bg: "#db2777", bgSoft: "#fdf2f8", text: "#fff1f2" },
  { bg: "#d97706", bgSoft: "#fffbeb", text: "#fffbeb" },
  { bg: "#059669", bgSoft: "#ecfdf5", text: "#ecfdf5" },
  { bg: "#0284c7", bgSoft: "#f0f9ff", text: "#f0f9ff" },
  { bg: "#7c3aed", bgSoft: "#f5f3ff", text: "#f5f3ff" },
  { bg: "#0d9488", bgSoft: "#f0fdfa", text: "#f0fdfa" },
  { bg: "#ea580c", bgSoft: "#fff7ed", text: "#fff7ed" },
];

type CalendarEvent = {
  key: string;
  courseIndex: number;
  slotIndex: number;
  course: Course;
  slot: CourseSlot;
  start: number;
  end: number;
  col: number;
  cols: number;
};

type DragState = {
  type: "move" | "start" | "end";
  courseIndex: number;
  slotIndex: number;
  pointerId: number;
  originY: number;
  origStart: number;
  origEnd: number;
  moved: boolean;
};

function pad(value: number) {
  return String(value).padStart(2, "0");
}

function parseMinutes(value: string) {
  const match = value.trim().match(/^(\d{1,2}):(\d{2})$/);
  if (!match) return null;
  return Number(match[1]) * 60 + Number(match[2]);
}

function formatMinutes(total: number) {
  const clamped = Math.max(0, Math.min(total, 24 * 60 - 1));
  const hours = Math.floor(clamped / 60);
  const minutes = clamped % 60;
  return `${pad(hours)}:${pad(minutes)}`;
}

function snapMinutes(value: number) {
  return Math.round(value / SNAP) * SNAP;
}

function colorForName(name: string) {
  let hash = 0;
  for (const char of name) hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
  return PALETTE[hash % PALETTE.length];
}

function minutesToY(minutes: number) {
  return ((minutes - DAY_START) / 60) * HOUR_HEIGHT;
}

function yToMinutesDelta(deltaY: number) {
  return (deltaY / HOUR_HEIGHT) * 60;
}

function clampRange(start: number, end: number) {
  let nextStart = Math.max(DAY_START, Math.min(start, DAY_END - MIN_DURATION));
  let nextEnd = Math.max(nextStart + MIN_DURATION, Math.min(end, DAY_END));
  if (nextEnd - nextStart < MIN_DURATION) {
    nextEnd = nextStart + MIN_DURATION;
  }
  return [nextStart, nextEnd] as const;
}

function visibleDays(courses: Course[]): Weekday[] {
  const weekend = courses.some((course) =>
    (course.slots || []).some(
      (slot) => slot.weekday === "Saturday" || slot.weekday === "Sunday",
    ),
  );
  return weekend ? [...WEEKDAYS_MON_FRI, "Saturday", "Sunday"] : WEEKDAYS_MON_FRI;
}

function packDay(events: CalendarEvent[]): CalendarEvent[] {
  const sorted = [...events].sort((a, b) => a.start - b.start || a.end - b.end);
  const clusters: CalendarEvent[][] = [];

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

type WeeklyCalendarProps = {
  courses: Course[];
  onChange: (next: Course[] | ((current: Course[]) => Course[])) => void;
};

export default function WeeklyCalendar({ courses, onChange }: WeeklyCalendarProps) {
  const { t } = useI18n();
  const dragRef = useRef<DragState | null>(null);
  const [editing, setEditing] = useState<{
    courseIndex: number;
    slotIndex: number;
  } | null>(null);

  useEffect(() => {
    if (!editing) return;
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previous;
    };
  }, [editing]);

  const days = useMemo(() => visibleDays(courses), [courses]);
  const hours = useMemo(
    () => Array.from({ length: (DAY_END - DAY_START) / 60 }, (_, index) => 8 + index),
    [],
  );

  const eventsByDay = useMemo(() => {
    const grouped = new Map<Weekday, CalendarEvent[]>();
    courses.forEach((course, courseIndex) => {
      (course.slots || []).forEach((slot, slotIndex) => {
        const start = parseMinutes(slot.startTime);
        const end = parseMinutes(slot.endTime);
        if (start === null || end === null || end <= start) return;
        if (end <= DAY_START || start >= DAY_END) return;
        const event: CalendarEvent = {
          key: `${courseIndex}-${slotIndex}`,
          courseIndex,
          slotIndex,
          course,
          slot,
          start: Math.max(start, DAY_START),
          end: Math.min(end, DAY_END),
          col: 0,
          cols: 1,
        };
        const list = grouped.get(slot.weekday) ?? [];
        list.push(event);
        grouped.set(slot.weekday, list);
      });
    });
    const packed = new Map<Weekday, CalendarEvent[]>();
    for (const day of days) {
      packed.set(day, packDay(grouped.get(day) ?? []));
    }
    return packed;
  }, [courses, days]);

  const editingEvent = editing
    ? courses[editing.courseIndex]?.slots?.[editing.slotIndex] && {
        course: courses[editing.courseIndex],
        slot: courses[editing.courseIndex].slots[editing.slotIndex],
      }
    : null;

  function patchSlot(
    courseIndex: number,
    slotIndex: number,
    patch: Partial<CourseSlot>,
    coursePatch?: Partial<Course>,
  ) {
    onChange((current) =>
      current.map((course, index) => {
        if (index !== courseIndex) return course;
        return {
          ...course,
          ...coursePatch,
          slots: (course.slots || []).map((slot, sIndex) =>
            sIndex === slotIndex ? { ...slot, ...patch } : slot,
          ),
        };
      }),
    );
  }

  function applyTime(courseIndex: number, slotIndex: number, start: number, end: number) {
    const [nextStart, nextEnd] = clampRange(snapMinutes(start), snapMinutes(end));
    patchSlot(courseIndex, slotIndex, {
      startTime: formatMinutes(nextStart),
      endTime: formatMinutes(nextEnd),
    });
  }

  function deleteSlot(courseIndex: number, slotIndex: number) {
    onChange((current) =>
      current.map((course, index) => {
        if (index !== courseIndex) return course;
        return {
          ...course,
          slots: (course.slots || []).filter((_, sIndex) => sIndex !== slotIndex),
        };
      }),
    );
    setEditing(null);
  }

  function onPointerDown(
    event: React.PointerEvent<HTMLButtonElement>,
    calendarEvent: CalendarEvent,
  ) {
    if (event.button !== 0) return;
    event.preventDefault();
    event.stopPropagation();
    event.currentTarget.setPointerCapture(event.pointerId);
    const handle = (event.target as HTMLElement)
      .closest("[data-handle]")
      ?.getAttribute("data-handle");
    const type: DragState["type"] =
      handle === "start" || handle === "end" ? handle : "move";
    dragRef.current = {
      type,
      courseIndex: calendarEvent.courseIndex,
      slotIndex: calendarEvent.slotIndex,
      pointerId: event.pointerId,
      originY: event.clientY,
      origStart: parseMinutes(calendarEvent.slot.startTime) ?? calendarEvent.start,
      origEnd: parseMinutes(calendarEvent.slot.endTime) ?? calendarEvent.end,
      moved: false,
    };
  }

  function onPointerMove(event: React.PointerEvent<HTMLButtonElement>) {
    const drag = dragRef.current;
    if (!drag || event.pointerId !== drag.pointerId) return;
    const rawDelta = yToMinutesDelta(event.clientY - drag.originY);
    if (Math.abs(event.clientY - drag.originY) > 4) drag.moved = true;
    const delta = snapMinutes(rawDelta);

    if (drag.type === "move") {
      const duration = drag.origEnd - drag.origStart;
      applyTime(drag.courseIndex, drag.slotIndex, drag.origStart + delta, drag.origStart + delta + duration);
      return;
    }
    if (drag.type === "start") {
      applyTime(
        drag.courseIndex,
        drag.slotIndex,
        snapMinutes(drag.origStart + delta),
        drag.origEnd,
      );
      return;
    }
    applyTime(
      drag.courseIndex,
      drag.slotIndex,
      drag.origStart,
      snapMinutes(drag.origEnd + delta),
    );
  }

  function onPointerUp(event: React.PointerEvent<HTMLButtonElement>, calendarEvent: CalendarEvent) {
    const drag = dragRef.current;
    if (!drag || event.pointerId !== drag.pointerId) return;
    const moved = drag.moved;
    dragRef.current = null;
    try {
      event.currentTarget.releasePointerCapture(event.pointerId);
    } catch {
      /* already released */
    }
    if (!moved && drag.type === "move") {
      setEditing({
        courseIndex: calendarEvent.courseIndex,
        slotIndex: calendarEvent.slotIndex,
      });
    }
  }

  return (
    <div className="relative">
      <div className="overflow-x-auto">
        <div
          className="min-w-[720px]"
          style={{
            display: "grid",
            gridTemplateColumns: `56px repeat(${days.length}, minmax(0, 1fr))`,
          }}
        >
          <div className="sticky top-0 z-20 border-b border-stone-200 bg-white" />
          {days.map((day) => (
            <div
              key={day}
              className="sticky top-0 z-20 border-b border-l border-stone-200 bg-white py-3 text-center"
            >
              <p className="text-[11px] font-medium uppercase tracking-wide text-stone-400">
                {t.calendar.weekdays[day]}
              </p>
            </div>
          ))}

          <div className="relative" style={{ height: GRID_HEIGHT }}>
            {hours.map((hour) => (
              <div
                key={hour}
                className="absolute right-2 -translate-y-2 text-[11px] tabular-nums text-stone-400"
                style={{ top: minutesToY(hour * 60) }}
              >
                {pad(hour)}:00
              </div>
            ))}
          </div>

          {days.map((day) => (
            <div
              key={`${day}-col`}
              className="relative border-l border-stone-200 bg-[#fbfaf7]"
              style={{ height: GRID_HEIGHT }}
            >
              {hours.map((hour) => (
                <div key={hour}>
                  <div
                    className="absolute inset-x-0 border-t border-stone-200"
                    style={{ top: minutesToY(hour * 60) }}
                  />
                  <div
                    className="absolute inset-x-0 border-t border-dashed border-stone-100"
                    style={{ top: minutesToY(hour * 60 + 30) }}
                  />
                </div>
              ))}

              {(eventsByDay.get(day) ?? []).map((calendarEvent) => {
                const color = colorForName(calendarEvent.course.name);
                const top = minutesToY(calendarEvent.start);
                const height = Math.max(
                  minutesToY(calendarEvent.end) - top,
                  (MIN_DURATION / 60) * HOUR_HEIGHT,
                );
                const width = `calc((100% - 8px) / ${calendarEvent.cols})`;
                const left = `calc(4px + ((100% - 8px) / ${calendarEvent.cols}) * ${calendarEvent.col})`;
                return (
                  <button
                    key={calendarEvent.key}
                    type="button"
                    aria-label={`${calendarEvent.course.name} ${calendarEvent.slot.startTime} to ${calendarEvent.slot.endTime}`}
                    className="absolute touch-none overflow-hidden rounded-xl px-2 py-1 text-left shadow-sm outline-none ring-0 select-none"
                    style={{
                      top,
                      height,
                      left,
                      width,
                      background: color.bg,
                      color: color.text,
                      zIndex: dragRef.current?.courseIndex === calendarEvent.courseIndex ? 10 : 1,
                    }}
                    onPointerDown={(event) => onPointerDown(event, calendarEvent)}
                    onPointerMove={onPointerMove}
                    onPointerUp={(event) => onPointerUp(event, calendarEvent)}
                    onPointerCancel={(event) => onPointerUp(event, calendarEvent)}
                  >
                    <span data-handle="start" className="absolute inset-x-3 top-0 h-2 cursor-ns-resize rounded-full" />
                    <p className="truncate text-[12px] font-semibold leading-4">
                      {calendarEvent.course.name}
                    </p>
                    <p className="truncate text-[10px] opacity-90">
                      {calendarEvent.slot.startTime}–{calendarEvent.slot.endTime}
                    </p>
                    {calendarEvent.slot.location ? (
                      <p className="truncate text-[10px] opacity-80">
                        {calendarEvent.slot.location}
                      </p>
                    ) : null}
                    <span data-handle="end" className="absolute inset-x-3 bottom-0 h-2 cursor-ns-resize rounded-full" />
                  </button>
                );
              })}
            </div>
          ))}
        </div>
      </div>

      {editing && editingEvent
        ? createPortal(
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 backdrop-blur-sm"
          onClick={() => setEditing(null)}
        >
          <div
            className="max-h-[90vh] w-full max-w-md overflow-y-auto rounded-2xl bg-white p-4 shadow-2xl dark:bg-neutral-900"
            onClick={(event) => event.stopPropagation()}
            role="dialog"
            aria-label={t.calendar.edit}
          >
            <p className="text-sm font-semibold text-stone-900 dark:text-neutral-100">{t.calendar.edit}</p>
            <label className="mt-3 block text-xs font-medium text-stone-500">
              {t.calendar.course}
              <input
                className="mt-1 w-full rounded-xl border border-stone-200 px-3 py-2 text-sm text-stone-900 outline-none focus:border-indigo-400"
                value={editingEvent.course.name}
                onChange={(event) =>
                  patchSlot(editing.courseIndex, editing.slotIndex, {}, { name: event.target.value })
                }
              />
            </label>
            <label className="mt-3 block text-xs font-medium text-stone-500">
              {t.calendar.professor}
              <input
                className="mt-1 w-full rounded-xl border border-stone-200 px-3 py-2 text-sm text-stone-900 outline-none focus:border-indigo-400"
                value={editingEvent.course.professor}
                onChange={(event) =>
                  patchSlot(
                    editing.courseIndex,
                    editing.slotIndex,
                    {},
                    { professor: event.target.value },
                  )
                }
              />
            </label>
            <label className="mt-3 block text-xs font-medium text-stone-500">
              {t.calendar.location}
              <input
                className="mt-1 w-full rounded-xl border border-stone-200 px-3 py-2 text-sm text-stone-900 outline-none focus:border-indigo-400"
                value={editingEvent.slot.location}
                onChange={(event) =>
                  patchSlot(editing.courseIndex, editing.slotIndex, {
                    location: event.target.value,
                  })
                }
              />
            </label>
            <label className="mt-3 block text-xs font-medium text-stone-500">
              {t.calendar.weekday}
              <select
                className="mt-1 w-full rounded-xl border border-stone-200 px-3 py-2 text-sm text-stone-900 outline-none focus:border-indigo-400"
                value={
                  WEEKDAYS.includes(editingEvent.slot.weekday)
                    ? editingEvent.slot.weekday
                    : "Monday"
                }
                onChange={(event) =>
                  patchSlot(editing.courseIndex, editing.slotIndex, {
                    weekday: event.target.value as Weekday,
                  })
                }
              >
                {WEEKDAYS.map((day) => (
                  <option key={day} value={day}>
                    {t.calendar.weekdays[day]}
                  </option>
                ))}
              </select>
            </label>
            <p className="mt-3 text-xs text-stone-500 dark:text-neutral-400">
              {editingEvent.slot.startTime} – {editingEvent.slot.endTime} · {t.calendar.resizeHint}
            </p>
            <div className="mt-4 flex justify-between">
              <button
                type="button"
                className="rounded-full px-3 py-1.5 text-sm text-red-600 hover:bg-red-50"
                onClick={() => deleteSlot(editing.courseIndex, editing.slotIndex)}
              >
                {t.calendar.delete}
              </button>
              <button
                type="button"
                className="rounded-full bg-stone-900 px-4 py-1.5 text-sm font-medium text-white"
                onClick={() => setEditing(null)}
              >
                {t.calendar.done}
              </button>
            </div>
          </div>
        </div>,
        document.body,
      )
        : null}
    </div>
  );
}
