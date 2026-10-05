"use client";

import { useEffect, useRef, useState } from "react";
import { useI18n } from "@/lib/i18n";
import { SHARE_URL, renderShareCard } from "@/lib/shareCard";
import type { Course } from "@/lib/types";

const FALLBACK_MESSAGE =
  "Okay this is unreal — screenshot your schedule and it drops straight into iPhone/Google Calendar in one second. No more typing it in by hand! 👉 https://ics.necterelux.com";

export default function ExportSuccessModal({
  courses,
  onClose,
}: {
  courses: Course[];
  onClose: () => void;
}) {
  const { t } = useI18n();
  const [cardUrl, setCardUrl] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const blobRef = useRef<Blob | null>(null);

  const message = t.upload.shareMessage ?? FALLBACK_MESSAGE;
  const lineHref = `https://line.me/R/msg/text/?${encodeURIComponent(message)}`;
  const threadsHref = `https://www.threads.net/intent/post?text=${encodeURIComponent(message)}`;

  useEffect(() => {
    let cancelled = false;
    const current = { url: "" };
    setCardUrl(null);
    void renderShareCard(courses, {
      heading: t.upload.shareCardHeading ?? "This semester",
      footer: t.upload.shareCardFooter ?? `Course & Calendar Copilot · ${SHARE_URL.replace("https://", "")}`,
      weekdays: t.calendar.weekdays,
    })
      .then((blob) => {
        if (cancelled) return;
        blobRef.current = blob;
        current.url = URL.createObjectURL(blob);
        setCardUrl(current.url);
      })
      .catch(() => {
        if (!cancelled) setCardUrl(null);
      });
    return () => {
      cancelled = true;
      if (current.url) URL.revokeObjectURL(current.url);
    };
  }, [courses, t]);

  useEffect(() => {
    if (!copied) return;
    const timer = window.setTimeout(() => setCopied(false), 2500);
    return () => window.clearTimeout(timer);
  }, [copied]);

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  async function copyShare() {
    try {
      await navigator.clipboard.writeText(message);
    } catch {
      const area = document.createElement("textarea");
      area.value = message;
      area.setAttribute("readonly", "true");
      document.body.appendChild(area);
      area.select();
      document.execCommand("copy");
      area.remove();
    }
    setCopied(true);
  }

  function downloadCard() {
    const blob = blobRef.current;
    if (!blob) return;
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = "schedule-share-card.png";
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="fixed inset-0 z-[90] flex items-center justify-center bg-stone-900/50 p-4">
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="export-success-title"
        className="flex max-h-[calc(100vh-2rem)] w-full max-w-4xl flex-col overflow-hidden rounded-3xl bg-white shadow-xl"
      >
        <div className="border-b border-stone-200 px-5 py-4 sm:px-6">
          <p className="text-sm font-semibold text-indigo-600">
            {t.upload.shareEyebrow ?? "Exported! 🎉"}
          </p>
          <h2 id="export-success-title" className="mt-1 text-xl font-semibold text-stone-900">
            {t.upload.shareTitle ?? "Your schedule is on your device!"}
          </h2>
          <p className="mt-2 text-sm leading-6 text-stone-600">
            {t.upload.shareSubtitle ??
              "Like it? Share it with your classmates and skip the manual typing. 🚀"}
          </p>
        </div>

        <div className="grid min-h-0 flex-1 gap-5 overflow-auto px-5 py-4 sm:px-6 md:grid-cols-[220px_minmax(0,1fr)]">
          <div className="mx-auto w-full max-w-[220px]">
            {cardUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={cardUrl}
                alt={t.upload.shareCardHeading ?? "This semester"}
                className="w-full rounded-2xl border border-stone-200 shadow-sm"
              />
            ) : (
              <div className="aspect-[9/16] w-full animate-pulse rounded-2xl bg-stone-100" />
            )}
          </div>

          <div className="flex min-w-0 flex-col gap-3">
            <p className="rounded-2xl bg-stone-50 px-4 py-3 text-sm leading-6 text-stone-700">{message}</p>
            {copied ? (
              <p
                role="status"
                className="rounded-full bg-emerald-50 px-4 py-2 text-sm font-medium text-emerald-700"
              >
                {t.upload.shareCopied ?? "Share text copied!"}
              </p>
            ) : null}
            <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap">
              <button
                type="button"
                onClick={() => void copyShare()}
                className="rounded-full bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-500"
              >
                {t.upload.shareCopy ?? "Copy referral link"}
              </button>
              <a
                href={lineHref}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center justify-center rounded-full bg-[#06C755] px-4 py-2 text-sm font-medium text-white hover:brightness-95"
              >
                {t.upload.shareLine ?? "Share on LINE"}
              </a>
              <a
                href={threadsHref}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center justify-center rounded-full bg-stone-900 px-4 py-2 text-sm font-medium text-white hover:bg-stone-800"
              >
                {t.upload.shareThreads ?? "Share on Threads"}
              </a>
            </div>
            <button
              type="button"
              onClick={downloadCard}
              disabled={!cardUrl}
              className="rounded-full border border-stone-300 px-4 py-2 text-sm font-medium text-stone-800 hover:bg-stone-50 disabled:opacity-60"
            >
              {t.upload.shareDownloadCard ?? "Download share card"}
            </button>
          </div>
        </div>

        <div className="flex justify-end border-t border-stone-200 px-5 py-4 sm:px-6">
          <button
            type="button"
            onClick={onClose}
            className="rounded-full bg-stone-900 px-4 py-2 text-sm font-medium text-white hover:bg-stone-800"
          >
            {t.upload.shareClose ?? "Done"}
          </button>
        </div>
      </div>
    </div>
  );
}
