"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  WEEKDAYS,
  type Course,
  type CourseSlot,
  type Weekday,
} from "@/lib/types";
import {
  inspectSchedule,
  normalizeSlot,
  placeTimeRanges,
  parseMinutes,
  formatMinutes,
  slotProblem,
  changeSlotTime,
  overlappingSlots,
  type TimeWindow,
} from "@/lib/course-time";
import { useI18n } from "@/lib/i18n";

const MIN_DURATION = 1;
const HOUR_HEIGHT = 72;
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
  window: TimeWindow;
};

function pad(value: number) {
  return String(value).padStart(2, "0");
}

function colorForName(name: string) {
  let hash = 0;
  for (const char of name) hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
  return PALETTE[hash % PALETTE.length];
}

type WeeklyCalendarProps = {
  courses: Course[];
  onChange: (next: Course[] | ((current: Course[]) => Course[])) => void;
};

export default function WeeklyCalendar({
  courses,
  onChange,
}: WeeklyCalendarProps) {
  const { t } = useI18n();
  const dragRef = useRef<DragState | null>(null);
  const [dragWindow, setDragWindow] = useState<TimeWindow | null>(null);
  const [timeDraft, setTimeDraft] = useState({
    startTime: "",
    endTime: "",
    location: "",
    weekday: "Monday" as Weekday,
  });
  const [editError, setEditError] = useState("");
  const inspection = useMemo(() => inspectSchedule(courses), [courses]);
  const window = dragWindow ?? inspection.window;
  const GRID_HEIGHT = ((window.end - window.start) / 60) * HOUR_HEIGHT;
  const minutesToY = (minutes: number) =>
    ((minutes - window.start) / 60) * HOUR_HEIGHT;
  const [editing, setEditing] = useState<{
    courseIndex: number;
    slotIndex: number;
  } | null>(null);

  useEffect(() => {
    if (!editing) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setEditing(null);
    };
    document.addEventListener("keydown", onKey);
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previous;
      document.removeEventListener("keydown", onKey);
    };
  }, [editing]);

  const days = inspection.days;
  const hours = Array.from(
    { length: (window.end - window.start) / 60 + 1 },
    (_, i) => window.start / 60 + i,
  );

  const eventsByDay = useMemo(() => {
    const grouped = new Map<Weekday, CalendarEvent[]>();
    courses.forEach((course, courseIndex) => {
      (course.slots || []).forEach((slot, slotIndex) => {
        const start = parseMinutes(slot.startTime);
        const end = parseMinutes(slot.endTime);
        if (slotProblem(slot) || start === null || end === null) return;
        const event: CalendarEvent = {
          key: `${courseIndex}-${slotIndex}`,
          courseIndex,
          slotIndex,
          course,
          slot,
          start,
          end,
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
      packed.set(day, placeTimeRanges(grouped.get(day) ?? []));
    }
    return packed;
  }, [courses, days]);

  const editingEvent = editing
    ? courses[editing.courseIndex] && {
        course: courses[editing.courseIndex],
        slot: courses[editing.courseIndex].slots[editing.slotIndex] ?? {
          weekday: "Monday" as Weekday,
          startTime: "09:00",
          endTime: "10:00",
          location: "",
        },
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

  function openEdit(courseIndex: number, slotIndex: number) {
    const slot = courses[courseIndex].slots[slotIndex];
    setTimeDraft({
      startTime: slot?.startTime ?? "09:00",
      endTime: slot?.endTime ?? "10:00",
      weekday: slot?.weekday ?? "Monday",
      location: slot?.location ?? "",
    });
    setEditError("");
    setEditing({ courseIndex, slotIndex });
  }

  function saveTime() {
    if (!editing) return;
    const normalized = normalizeSlot(timeDraft);
    if (!normalized.slot) {
      setEditError(normalized.problem);
      return;
    }
    const next = normalized.slot;
    onChange((current) =>
      current.map((c, i) =>
        i !== editing.courseIndex
          ? c
          : {
              ...c,
              slots:
                editing.slotIndex < 0
                  ? [...c.slots, next]
                  : c.slots.map((s, j) =>
                      j === editing.slotIndex
                        ? { ...s, ...next, location: s.location }
                        : s,
                    ),
            },
      ),
    );
    setEditing(null);
  }

  function deleteSlot(courseIndex: number, slotIndex: number) {
    const last = courses[courseIndex].slots.length <= 1;
    if (last && !globalThis.confirm("刪除這門課？")) return;
    onChange((current) =>
      current.flatMap((course, index) =>
        index !== courseIndex
          ? [course]
          : last
            ? []
            : [
                {
                  ...course,
                  slots: course.slots.filter((_, i) => i !== slotIndex),
                },
              ],
      ),
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
    setDragWindow({ ...window });
    dragRef.current = {
      type,
      courseIndex: calendarEvent.courseIndex,
      slotIndex: calendarEvent.slotIndex,
      pointerId: event.pointerId,
      originY: event.clientY,
      origStart:
        parseMinutes(calendarEvent.slot.startTime) ?? calendarEvent.start,
      origEnd: parseMinutes(calendarEvent.slot.endTime) ?? calendarEvent.end,
      moved: false,
      window: { ...window },
    };
  }

  function onPointerMove(event: React.PointerEvent<HTMLButtonElement>) {
    const drag = dragRef.current;
    if (!drag || event.pointerId !== drag.pointerId) return;
    if (Math.abs(event.clientY - drag.originY) > 4) drag.moved = true;
    if (!drag.moved) return;
    const original = {
      ...courses[drag.courseIndex].slots[drag.slotIndex],
      startTime: formatMinutes(drag.origStart),
      endTime: formatMinutes(drag.origEnd),
    };
    const next = changeSlotTime(
      original,
      drag.type,
      ((event.clientY - drag.originY) / HOUR_HEIGHT) * 60,
      drag.window,
    );
    patchSlot(drag.courseIndex, drag.slotIndex, next);
  }

  function onPointerUp(
    event: React.PointerEvent<HTMLButtonElement>,
    calendarEvent: CalendarEvent,
  ) {
    const drag = dragRef.current;
    if (!drag || event.pointerId !== drag.pointerId) return;
    const moved = drag.moved;
    dragRef.current = null;
    setDragWindow(null);
    try {
      event.currentTarget.releasePointerCapture(event.pointerId);
    } catch {
      /* already released */
    }
    if (!moved && drag.type === "move") {
      openEdit(calendarEvent.courseIndex, calendarEvent.slotIndex);
    }
  }

  return (
    <div className="relative">
      {overlappingSlots(courses).length > 0 ? (
        <p role="status" className="mb-3 text-amber-700">
          課程時段重疊，請檢查；仍可保留並輸出。
        </p>
      ) : null}
      <details className="mb-3">
        <summary>課程明細與精確編輯</summary>
        {courses.flatMap((c, ci) =>
          c.slots.map((s, si) =>
            !slotProblem(s) ? (
              <button
                className="block p-2"
                type="button"
                key={`${ci}-${si}`}
                onClick={() => openEdit(ci, si)}
              >
                {c.name} · {s.weekday} {s.startTime}–{s.endTime}
              </button>
            ) : null,
          ),
        )}
      </details>
      {inspection.problems.length > 0 ? (
        <section
          aria-label="待修正課程"
          className="mb-4 rounded-xl border border-amber-300 p-3"
        >
          <h3>課表有待修正內容，修正前無法輸出</h3>
          {inspection.problems.map((p) => {
            const c = courses[p.courseIndex],
              s = c.slots[p.slotIndex];
            return (
              <div key={`${p.courseIndex}-${p.slotIndex}`} className="my-2">
                <p>
                  {c.name} ·{" "}
                  {s ? `${s.weekday} ${s.startTime}–${s.endTime}` : "沒有時段"}{" "}
                  · {p.message}
                </p>
                <button
                  type="button"
                  onClick={() => openEdit(p.courseIndex, p.slotIndex)}
                >
                  編輯修正
                </button>
                {" · "}
                <button
                  type="button"
                  onClick={() => deleteSlot(p.courseIndex, p.slotIndex)}
                >
                  {c.slots.length <= 1 ? "刪除這門課" : "刪除這個時段"}
                </button>
              </div>
            );
          })}
        </section>
      ) : null}
      <div className="overflow-x-auto">
        <div
          className="min-w-[720px] pb-4"
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
                      zIndex: 1,
                    }}
                    onClick={(event) => {
                      if (event.detail === 0)
                        openEdit(
                          calendarEvent.courseIndex,
                          calendarEvent.slotIndex,
                        );
                    }}
                    onPointerDown={(event) =>
                      onPointerDown(event, calendarEvent)
                    }
                    onPointerMove={onPointerMove}
                    onPointerUp={(event) => onPointerUp(event, calendarEvent)}
                    onPointerCancel={() => {
                      const drag = dragRef.current;
                      if (drag)
                        patchSlot(drag.courseIndex, drag.slotIndex, {
                          startTime: formatMinutes(drag.origStart),
                          endTime: formatMinutes(drag.origEnd),
                        });
                      dragRef.current = null;
                      setDragWindow(null);
                    }}
                  >
                    <span
                      data-handle="start"
                      className="absolute inset-x-3 top-0 h-2 cursor-ns-resize rounded-full"
                    />
                    <p className="truncate text-[12px] font-semibold leading-4">
                      {calendarEvent.course.name}
                    </p>
                    <p className="truncate text-[10px] opacity-90">
                      {calendarEvent.slot.startTime}–
                      {calendarEvent.slot.endTime}
                    </p>
                    {calendarEvent.slot.location ? (
                      <p className="truncate text-[10px] opacity-80">
                        {calendarEvent.slot.location}
                      </p>
                    ) : null}
                    <span
                      data-handle="end"
                      className="absolute inset-x-3 bottom-0 h-2 cursor-ns-resize rounded-full"
                    />
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
                <p className="text-sm font-semibold text-stone-900 dark:text-neutral-100">
                  {t.calendar.edit}
                </p>
                <label className="mt-3 block text-xs font-medium text-stone-500">
                  {t.calendar.course}
                  <input
                    className="mt-1 w-full rounded-xl border border-stone-200 px-3 py-2 text-sm text-stone-900 outline-none focus:border-indigo-400"
                    value={editingEvent.course.name}
                    onChange={(event) =>
                      patchSlot(
                        editing.courseIndex,
                        editing.slotIndex,
                        {},
                        { name: event.target.value },
                      )
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
                    value={
                      editing.slotIndex < 0
                        ? timeDraft.location
                        : editingEvent.slot.location
                    }
                    onChange={(event) => {
                      if (editing.slotIndex < 0)
                        setTimeDraft({
                          ...timeDraft,
                          location: event.target.value,
                        });
                      else
                        patchSlot(editing.courseIndex, editing.slotIndex, {
                          location: event.target.value,
                        });
                    }}
                  />
                </label>
                <label className="mt-3 block text-xs font-medium text-stone-500">
                  {t.calendar.weekday}
                  <select
                    className="mt-1 w-full rounded-xl border border-stone-200 px-3 py-2 text-sm text-stone-900 outline-none focus:border-indigo-400"
                    value={timeDraft.weekday}
                    onChange={(event) =>
                      setTimeDraft({
                        ...timeDraft,
                        weekday: event.target.value as Weekday,
                      })
                    }
                  >
                    {!WEEKDAYS.includes(timeDraft.weekday) ? (
                      <option value={timeDraft.weekday}>
                        無效星期：{timeDraft.weekday}
                      </option>
                    ) : null}
                    {WEEKDAYS.map((day) => (
                      <option key={day} value={day}>
                        {t.calendar.weekdays[day]}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="mt-3 block">
                  開始時間
                  <input
                    aria-label="開始時間"
                    className="block w-full border p-2"
                    value={timeDraft.startTime}
                    onChange={(e) =>
                      setTimeDraft({ ...timeDraft, startTime: e.target.value })
                    }
                  />
                </label>
                <label className="mt-3 block">
                  結束時間
                  <input
                    aria-label="結束時間"
                    className="block w-full border p-2"
                    value={timeDraft.endTime}
                    onChange={(e) =>
                      setTimeDraft({ ...timeDraft, endTime: e.target.value })
                    }
                  />
                </label>
                {editError ? <p role="alert">{editError}</p> : null}
                <button type="button" onClick={() => setEditing(null)}>
                  取消
                </button>
                <div className="mt-4 flex justify-between">
                  <button
                    type="button"
                    className="rounded-full px-3 py-1.5 text-sm text-red-600 hover:bg-red-50"
                    onClick={() =>
                      deleteSlot(editing.courseIndex, editing.slotIndex)
                    }
                  >
                    {editingEvent.course.slots.length <= 1
                      ? "刪除這門課"
                      : "刪除這個時段"}
                  </button>
                  <button
                    type="button"
                    className="rounded-full bg-stone-900 px-4 py-1.5 text-sm font-medium text-white"
                    onClick={saveTime}
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
