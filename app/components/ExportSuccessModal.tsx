"use client";

import { useEffect, useState, useSyncExternalStore } from "react";
import { useI18n } from "@/lib/i18n";
import {
  downloadBlob,
  isAppleCalendarDevice,
} from "@/lib/calendar-export-browser";
import type { CalendarExportController } from "./CalendarExport";

export default function ExportSuccessModal({
  flow,
  previousVersion = false,
}: {
  flow: CalendarExportController;
  previousVersion?: boolean;
}) {
  const { t, locale } = useI18n();
  const text = (zh: string, en: string) => (locale.startsWith("zh") ? zh : en);
  const state = useSyncExternalStore(
    flow.subscribe,
    flow.getSnapshot,
    flow.getSnapshot,
  );
  const onClose = flow.close;
  const [card, setCard] = useState<{ blob: Blob; url: string } | null>(null);
  const [copied, setCopied] = useState(false);
  const [cardError, setCardError] = useState("");
  const blob = state.image.blob;
  const cardUrl = card?.blob === blob ? card?.url : null;
  const message = text(
    "我用這個工具把課表截圖轉成可下載的行事曆檔案與分享圖片，匯入時再依裝置提示完成操作。👉 https://ics.necterelux.com",
    "Turn a schedule screenshot into a downloadable calendar and share image. Follow your device prompts to finish importing. 👉 https://ics.necterelux.com",
  );
  const lineHref = `https://line.me/R/msg/text/?${encodeURIComponent(message)}`;
  const threadsHref = `https://www.threads.net/intent/post?text=${encodeURIComponent(message)}`;

  useEffect(() => {
    if (!blob) return;
    let active = true;
    const url = URL.createObjectURL(blob);
    queueMicrotask(() => {
      if (active) setCard({ blob, url });
    });
    return () => {
      active = false;
      URL.revokeObjectURL(url);
    };
  }, [blob]);

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
    if (!blob || !cardUrl) return;
    try {
      downloadBlob(blob, "schedule-share-card.png");
      setCardError("");
    } catch {
      setCardError(
        text(
          "無法下載分享圖片，請重試。",
          "Could not trigger image download. Please retry.",
        ),
      );
    }
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
            {text("行事曆匯出", "Calendar export")}
          </p>
          <h2
            id="export-success-title"
            className="mt-1 text-xl font-semibold text-stone-900"
          >
            {text("行事曆檔案已準備好", "Calendar file is ready")}
          </h2>
          <p className="mt-2 text-sm leading-6 text-stone-600">
            {text(
              "下載或交付已觸發後，請依裝置提示完成保存或匯入；網站無法確認是否完成。",
              "After a handoff is triggered, follow your device prompts to save or import. This site cannot confirm completion.",
            )}
            {previousVersion
              ? text(
                  " 這次結果對應先前的課表版本。",
                  " This result uses an earlier schedule version.",
                )
              : ""}
          </p>
        </div>

        <div className="grid min-h-0 flex-1 gap-5 overflow-auto px-5 py-4 sm:px-6 md:grid-cols-[220px_minmax(0,1fr)]">
          <div className="order-2 mx-auto w-full max-w-[220px] md:order-1">
            {cardUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={cardUrl}
                alt={t.upload.shareCardHeading ?? "This semester"}
                className="w-full rounded-2xl border border-stone-200 shadow-sm"
              />
            ) : state.image.phase === "error" ? (
              <div role="alert" className="rounded-xl bg-amber-50 p-4">
                {state.image.message}
                <button
                  type="button"
                  className="mt-2 underline"
                  onClick={() => void flow.retryImage()}
                >
                  {text("重試產生圖片", "Retry image")}
                </button>
              </div>
            ) : (
              <p role="status">
                {text("分享圖片準備中…", "Preparing share image…")}
              </p>
            )}
            {cardError ? <p role="alert">{cardError}</p> : null}
          </div>

          <div className="order-1 flex min-w-0 flex-col gap-3 md:order-2">
            {state.problem ? (
              <p role="alert" className="rounded-xl bg-amber-50 p-3">
                {state.problem.message}
              </p>
            ) : null}
            <p role="status">
              {state.deliveryPending
                ? text("正在觸發交付…", "Handing off…")
                : state.delivery === "download"
                  ? text(
                      "已觸發下載，請確認瀏覽器提示。",
                      "Download triggered. Check your browser prompts.",
                    )
                  : state.delivery === "apple"
                    ? text(
                        "已觸發 Apple 交付，請查看裝置提示。",
                        "Apple handoff triggered. Check your device prompts.",
                      )
                    : text(
                        "檔案可供交付；尚未確認下載或匯入。",
                        "File ready; download or import is not confirmed.",
                      )}
            </p>
            <button
              type="button"
              disabled={state.deliveryPending}
              onClick={() => void flow.deliver("download")}
              className="rounded-2xl bg-indigo-600 px-4 py-3 font-semibold text-white disabled:opacity-60"
            >
              {text("下載 ICS 檔案", "Download ICS file")}
            </button>
            {isAppleCalendarDevice() ? (
              <>
                <button
                  type="button"
                  disabled={state.deliveryPending}
                  onClick={() => void flow.deliver("apple")}
                  className="rounded-2xl border border-indigo-300 px-4 py-3 font-semibold"
                >
                  {text("交付至 Apple 日曆", "Hand off to Apple Calendar")}
                </button>
                <p className="rounded-xl bg-amber-50 p-3">
                  {text(
                    "請依裝置提示完成操作。Apple 專用交付尚未完成真機驗收；若無法使用，請選擇下載 ICS 檔案。",
                    "Follow your device prompts. Apple-specific handoff has not completed real-device acceptance; use the ICS download if needed.",
                  )}
                </p>
              </>
            ) : null}
            <p className="rounded-xl bg-stone-50 p-3">
              {text(
                "日期以產生當天的伺服器日期往後找對應星期（當天即使時間已過仍使用當天），每週重複 16 次；並非依學校學期安排。重複匯入可能新增重複事件，請自行檢查日曆。",
                "Dates use the corresponding weekday on or after the server generation date, including today even if class time has passed, repeating weekly 16 times. This is not a school term schedule. Repeated imports may add duplicates; check your calendar.",
              )}
            </p>
            <p className="rounded-2xl bg-stone-50 px-4 py-3 text-sm leading-6 text-stone-700">
              {message}
            </p>
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
