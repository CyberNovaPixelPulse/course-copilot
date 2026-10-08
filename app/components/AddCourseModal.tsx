"use client";

import { useEffect, useId, useState, type FormEvent } from "react";
import { WEEKDAYS, type Course, type Weekday } from "@/lib/types";
import { useI18n } from "@/lib/i18n";

const WEEKDAY_OPTIONS = WEEKDAYS.slice(0, 5);

function quarterHours(fromMinutes = 8 * 60, toMinutes = 22 * 60) {
  const values: string[] = [];
  for (let minutes = fromMinutes; minutes <= toMinutes; minutes += 15) {
    const hours = Math.floor(minutes / 60);
    const mins = minutes % 60;
    values.push(`${String(hours).padStart(2, "0")}:${String(mins).padStart(2, "0")}`);
  }
  return values;
}

const TIME_OPTIONS = quarterHours();

export default function AddCourseModal({
  onClose,
  onAdd,
}: {
  onClose: () => void;
  onAdd: (course: Course) => void;
}) {
  const { t } = useI18n();
  const titleId = useId();
  const [name, setName] = useState("");
  const [day, setDay] = useState<Weekday>("Monday");
  const [startTime, setStartTime] = useState("09:00");
  const [endTime, setEndTime] = useState("10:00");
  const [location, setLocation] = useState("");
  const [professor, setProfessor] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  function submit(event: FormEvent) {
    event.preventDefault();
    const trimmed = name.trim();
    if (!trimmed) {
      setError(t.upload.addCourseNameRequired ?? "請輸入課程名稱");
      return;
    }
    if (startTime >= endTime) {
      setError(t.upload.addCourseTimeInvalid ?? "結束時間須晚於開始時間");
      return;
    }
    onAdd({
      name: trimmed,
      professor: professor.trim(),
      slots: [
        {
          weekday: day,
          startTime,
          endTime,
          location: location.trim(),
        },
      ],
    });
  }

  const fieldClass =
    "mt-1 w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm text-slate-800 outline-none focus:border-indigo-400 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100";

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <button
        type="button"
        aria-label={t.upload.addCourseCancel ?? "取消"}
        className="absolute inset-0 bg-slate-900/40"
        onClick={onClose}
      />
      <form
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        onSubmit={submit}
        className="relative z-10 w-full max-w-md rounded-3xl border border-slate-200 bg-white p-5 shadow-xl dark:border-slate-700 dark:bg-slate-950"
      >
        <h3 id={titleId} className="text-lg font-semibold text-slate-900 dark:text-slate-100">
          {t.upload.addCourseTitle ?? "新增課程"}
        </h3>
        <label className="mt-4 block text-sm font-medium text-slate-700 dark:text-slate-200">
          {t.upload.addCourseName ?? "課程名稱"}
          <input
            autoFocus
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder={t.upload.addCourseNamePlaceholder ?? "微積分"}
            className={fieldClass}
          />
        </label>
        <label className="mt-3 block text-sm font-medium text-slate-700 dark:text-slate-200">
          {t.upload.addCourseDay ?? "星期幾"}
          <select value={day} onChange={(event) => setDay(event.target.value as Weekday)} className={fieldClass}>
            {WEEKDAY_OPTIONS.map((weekday) => (
              <option key={weekday} value={weekday}>
                {t.calendar.weekdays[weekday] ?? weekday}
              </option>
            ))}
          </select>
        </label>
        <div className="mt-3 grid grid-cols-2 gap-3">
          <label className="block text-sm font-medium text-slate-700 dark:text-slate-200">
            {t.upload.addCourseStart ?? "開始時間"}
            <select value={startTime} onChange={(event) => setStartTime(event.target.value)} className={fieldClass}>
              {TIME_OPTIONS.map((time) => (
                <option key={time} value={time}>
                  {time}
                </option>
              ))}
            </select>
          </label>
          <label className="block text-sm font-medium text-slate-700 dark:text-slate-200">
            {t.upload.addCourseEnd ?? "結束時間"}
            <select value={endTime} onChange={(event) => setEndTime(event.target.value)} className={fieldClass}>
              {TIME_OPTIONS.map((time) => (
                <option key={time} value={time}>
                  {time}
                </option>
              ))}
            </select>
          </label>
        </div>
        <label className="mt-3 block text-sm font-medium text-slate-700 dark:text-slate-200">
          {t.upload.addCourseLocation ?? "地點/教室"}
          <input
            value={location}
            onChange={(event) => setLocation(event.target.value)}
            placeholder={t.upload.addCourseLocationPlaceholder ?? "綜二 302"}
            className={fieldClass}
          />
        </label>
        <label className="mt-3 block text-sm font-medium text-slate-700 dark:text-slate-200">
          {t.upload.addCourseProfessor ?? "教授/備註"}
          <input
            value={professor}
            onChange={(event) => setProfessor(event.target.value)}
            placeholder={t.upload.addCourseProfessorPlaceholder ?? "選填"}
            className={fieldClass}
          />
        </label>
        {error ? <p className="mt-3 text-sm text-red-600">{error}</p> : null}
        <div className="mt-5 flex justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            className="rounded-full px-4 py-2 text-sm font-medium text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800"
          >
            {t.upload.addCourseCancel ?? "取消"}
          </button>
          <button
            type="submit"
            className="rounded-full bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-500"
          >
            {t.upload.addCourseConfirm ?? "確認新增"}
          </button>
        </div>
      </form>
    </div>
  );
}
