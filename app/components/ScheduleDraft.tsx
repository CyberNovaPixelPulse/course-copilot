"use client";

import { useEffect, useRef, useState } from "react";
import { isCourseStructure } from "@/lib/course-time";
import type { Course } from "@/lib/types";

const MAX_AGE = 7 * 86400000;

function persistDraft(key: string, accountId: string, courses: Course[]) {
  localStorage.setItem(
    key,
    JSON.stringify({ accountId, savedAt: Date.now(), courses }),
  );
}

export default function ScheduleDraft({
  accountId,
  courses,
  onRestore,
  zh,
}: {
  accountId: string;
  courses: Course[];
  onRestore: (courses: Course[]) => void;
  zh: boolean;
}) {
  const key = `cc_schedule_draft_v1:${accountId || "guest"}`;
  const [ready, setReady] = useState(false);
  const [pending, setPending] = useState<Course[] | null>(null);
  const [problem, setProblem] = useState(false);
  const [saved, setSaved] = useState(false);
  const edited = useRef(false);
  const text = (cn: string, en: string) => (zh ? cn : en);

  useEffect(() => {
    let active = true;
    queueMicrotask(() => {
      if (!active) return;
      try {
        const raw = localStorage.getItem(key);
        if (raw) {
          const value = JSON.parse(raw);
          if (
            value.accountId !== accountId ||
            !Number.isFinite(value.savedAt) ||
            !isCourseStructure(value.courses)
          )
            throw new Error("Invalid draft");
          if (Date.now() - value.savedAt > MAX_AGE)
            localStorage.removeItem(key);
          else if (value.courses.length) setPending(value.courses);
        }
      } catch {
        setProblem(true);
      }
      setReady(true);
    });
    return () => {
      active = false;
    };
  }, [accountId, key]);

  useEffect(() => {
    if (!ready || pending) return;
    if (courses.length) edited.current = true;
    if (!edited.current) return;
    let active = true;
    queueMicrotask(() => {
      if (!active) return;
      try {
        persistDraft(key, accountId, courses);
        setProblem(false);
        setSaved(true);
      } catch {
        setProblem(true);
        setSaved(false);
      }
    });
    return () => {
      active = false;
    };
  }, [accountId, courses, key, pending, ready]);

  useEffect(() => {
    if ((!problem && !pending) || !courses.length) return;
    const warn = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [problem, pending, courses.length]);

  function restore() {
    if (!pending) return;
    if (
      courses.length &&
      !window.confirm(
        text(
          "恢復草稿將取代目前課表，確定繼續？",
          "Replace the current schedule with the saved draft?",
        ),
      )
    )
      return;
    onRestore(pending);
    setPending(null);
  }

  return (
    <section
      aria-label={text("編輯草稿", "Editing draft")}
      className="my-4 text-sm text-stone-700"
    >
      {pending ? (
        <>
          <p>
            {text(
              "此瀏覽器有上次編輯草稿（保留 7 天）。選擇恢復或捨棄前，目前變更暫不保存。",
              "This browser has a saved draft (kept for 7 days). Choose restore or discard before current changes can be saved.",
            )}
          </p>
          <div className="flex flex-wrap gap-3">
            <button
              type="button"
              className="min-h-11 underline"
              onClick={restore}
            >
              {text("恢復上次編輯草稿", "Restore editing draft")}
            </button>
            <button
              type="button"
              className="min-h-11 underline"
              onClick={() => {
                try {
                  localStorage.removeItem(key);
                  setPending(null);
                  setProblem(false);
                } catch {
                  setProblem(true);
                }
              }}
            >
              {text(
                "捨棄舊草稿，保留目前課表",
                "Discard old draft, keep current schedule",
              )}
            </button>
          </div>
        </>
      ) : saved && !problem ? (
        <p role="status">
          {text(
            "編輯草稿已保存在此瀏覽器（7 天內，同帳號可恢復）。",
            "Editing draft saved in this browser for 7 days for this account.",
          )}
        </p>
      ) : null}
      {problem ? (
        <p role="alert">
          {text(
            "草稿無法讀取或保存，請勿重整或關閉頁面。",
            "Draft could not be read or saved. Keep this page open.",
          )}
          <button
            type="button"
            className="ml-3 min-h-11 underline"
            onClick={() => {
              try {
                persistDraft(key, accountId, courses);
                edited.current = true;
                setPending(null);
                setProblem(false);
                setSaved(true);
              } catch {
                setProblem(true);
                setSaved(false);
              }
            }}
          >
            {text("重試保存目前課表", "Retry saving current schedule")}
          </button>
        </p>
      ) : null}
    </section>
  );
}
