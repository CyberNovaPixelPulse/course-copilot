"use client";

import { useMemo, useRef, useState } from "react";
import Modal from "./Modal";
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
  { bg: "#DCEBE2", bgSoft: "#EAF3EE", text: "#233E34" },
  { bg: "#EAE2E8", bgSoft: "#F4EFF2", text: "#543747" },
  { bg: "#F0E7D3", bgSoft: "#F6F1E7", text: "#574728" },
  { bg: "#DFEAE2", bgSoft: "#EEF4F0", text: "#2C4837" },
  { bg: "#DDE8F0", bgSoft: "#EEF3F7", text: "#29465B" },
  { bg: "#E6E3EF", bgSoft: "#F1EFF6", text: "#453B61" },
  { bg: "#DAE9E7", bgSoft: "#ECF3F2", text: "#2C4A46" },
  { bg: "#F0E1D5", bgSoft: "#F7F0EA", text: "#5D402C" },
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
  readOnly?: boolean;
  onChange: (next: Course[] | ((current: Course[]) => Course[])) => void;
};

export default function WeeklyCalendar({
  courses,
  onChange,
  readOnly = false,
}: WeeklyCalendarProps) {
  const { t, locale } = useI18n();
  const dragRef = useRef<DragState | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const [dragWindow, setDragWindow] = useState<TimeWindow | null>(null);
  const [editDraft, setEditDraft] = useState({
    name: "",
    professor: "",
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
    if (readOnly) return;
    const slot = courses[courseIndex].slots[slotIndex];
    setEditDraft({
      name: courses[courseIndex].name,
      professor: courses[courseIndex].professor,
      startTime: slot?.startTime ?? "09:00",
      endTime: slot?.endTime ?? "10:00",
      weekday: slot?.weekday ?? "Monday",
      location: slot?.location ?? "",
    });
    setEditError("");
    setEditing({ courseIndex, slotIndex });
  }

  function saveEdit() {
    if (!editing) return;
    if (!editDraft.name.trim()) {
      setEditError(t.upload.addCourseNameRequired ?? "請輸入課程名稱");
      return;
    }
    const normalized = normalizeSlot({
      ...editDraft,
      location: editDraft.location.trim(),
    });
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
              name: editDraft.name.trim(),
              professor: editDraft.professor.trim(),
              slots:
                editing.slotIndex < 0
                  ? [...c.slots, next]
                  : c.slots.map((s, j) =>
                      j === editing.slotIndex ? { ...s, ...next } : s,
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
      <details className="calendar-details mb-3" hidden={readOnly}>
        <summary>課程明細與精確編輯</summary>
        {courses.flatMap((c, ci) =>
          c.slots.map((s, si) =>
            !slotProblem(s) ? (
              <button
                className="block min-h-11 p-2"
                type="button"
                key={`${ci}-${si}`}
                onClick={() => openEdit(ci, si)}
              >
                {c.name} · {t.calendar.weekdays[s.weekday] ?? s.weekday}{" "}
                {s.startTime}–{s.endTime}
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
                  {s
                    ? `${t.calendar.weekdays[s.weekday] ?? s.weekday} ${s.startTime}–${s.endTime}`
                    : "沒有時段"}{" "}
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
      <nav
        aria-label={
          locale.startsWith("zh") ? "星期快速定位" : "Jump to weekday"
        }
        className="mb-2 flex flex-wrap gap-1 sm:hidden"
      >
        {days.map((day, index) => (
          <button
            type="button"
            className="min-h-11 min-w-11 rounded-lg border px-2 text-sm"
            key={day}
            onClick={() => {
              const scroller = scrollRef.current;
              if (scroller)
                scroller.scrollTo({
                  left: (index * (scroller.scrollWidth - 56)) / days.length,
                  behavior: "smooth",
                });
            }}
          >
            {t.calendar.weekdays[day]}
          </button>
        ))}
      </nav>
      <p className="mb-2 text-sm text-stone-600 sm:hidden">
        {locale.startsWith("zh")
          ? "左右滑動查看整週，或點選上方星期。下方週曆也可用上方精確編輯清單操作。"
          : "Swipe sideways or choose a weekday. Use the detailed list above for precise editing."}
      </p>
      <div ref={scrollRef} className="calendar-scroll overflow-x-auto">
        <div
          className="calendar-grid min-w-[720px] pb-4"
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
              className="relative border-l border-stone-200 bg-white"
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
                    data-calendar-event
                    disabled={readOnly}
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
                    <p className="truncate text-[14px] font-semibold leading-5">
                      {calendarEvent.course.name}
                    </p>
                    <p className="truncate text-[12px] opacity-90">
                      {calendarEvent.slot.startTime}–
                      {calendarEvent.slot.endTime}
                    </p>
                    {calendarEvent.slot.location ? (
                      <p className="truncate text-[12px] opacity-80">
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

      {editing && editingEvent ? (
        <Modal
          onClose={() => setEditing(null)}
          label={t.calendar.edit}
          className="w-full max-w-md bg-white p-4 dark:bg-neutral-900"
        >
          <p className="text-sm font-semibold text-stone-900 dark:text-neutral-100">
            {t.calendar.edit}
          </p>
          <label className="mt-3 block text-xs font-medium text-stone-500">
            {t.calendar.course}
            <input
              className="mt-1 w-full rounded-xl border border-stone-200 px-3 py-2 text-sm text-stone-900 outline-none focus:border-indigo-400"
              value={editDraft.name}
              onChange={(event) =>
                setEditDraft({ ...editDraft, name: event.target.value })
              }
            />
          </label>
          <label className="mt-3 block text-xs font-medium text-stone-500">
            {t.calendar.professor}
            <input
              className="mt-1 w-full rounded-xl border border-stone-200 px-3 py-2 text-sm text-stone-900 outline-none focus:border-indigo-400"
              value={editDraft.professor}
              onChange={(event) =>
                setEditDraft({ ...editDraft, professor: event.target.value })
              }
            />
          </label>
          <label className="mt-3 block text-xs font-medium text-stone-500">
            {t.calendar.location}
            <input
              className="mt-1 w-full rounded-xl border border-stone-200 px-3 py-2 text-sm text-stone-900 outline-none focus:border-indigo-400"
              value={editDraft.location}
              onChange={(event) =>
                setEditDraft({ ...editDraft, location: event.target.value })
              }
            />
          </label>
          <label className="mt-3 block text-xs font-medium text-stone-500">
            {t.calendar.weekday}
            <select
              className="mt-1 w-full rounded-xl border border-stone-200 px-3 py-2 text-sm text-stone-900 outline-none focus:border-indigo-400"
              value={editDraft.weekday}
              onChange={(event) =>
                setEditDraft({
                  ...editDraft,
                  weekday: event.target.value as Weekday,
                })
              }
            >
              {!WEEKDAYS.includes(editDraft.weekday) ? (
                <option value={editDraft.weekday}>
                  無效星期：{editDraft.weekday}
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
              value={editDraft.startTime}
              onChange={(e) =>
                setEditDraft({ ...editDraft, startTime: e.target.value })
              }
            />
          </label>
          <label className="mt-3 block">
            結束時間
            <input
              aria-label="結束時間"
              className="block w-full border p-2"
              value={editDraft.endTime}
              onChange={(e) =>
                setEditDraft({ ...editDraft, endTime: e.target.value })
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
              onClick={() => deleteSlot(editing.courseIndex, editing.slotIndex)}
            >
              {editingEvent.course.slots.length <= 1
                ? "刪除這門課"
                : "刪除這個時段"}
            </button>
            <button
              type="button"
              className="rounded-full bg-stone-900 px-4 py-1.5 text-sm font-medium text-white"
              onClick={saveEdit}
            >
              {t.calendar.done}
            </button>
          </div>
        </Modal>
      ) : null}
    </div>
  );
}
