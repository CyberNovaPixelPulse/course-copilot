"use client";
import { useEffect, useMemo, useSyncExternalStore } from "react";
import { useEntitlements } from "./EntitlementDisplay";
import { createBrowserRecognitionBatch } from "@/lib/recognition-batch-browser";
import type { BatchItemStatus } from "@/lib/recognition-batch";
import type { Course } from "@/lib/types";
export function useRecognitionBatch(accountId: string) {
  const { store } = useEntitlements();
  const flow = useMemo(
    () => createBrowserRecognitionBatch(accountId, store),
    [accountId, store],
  );
  useEffect(() => {
    flow.start();
    return () => flow.dispose();
  }, [flow]);
  const state = useSyncExternalStore(
    flow.subscribe,
    flow.getSnapshot,
    flow.getSnapshot,
  );
  return { flow, state };
}
export default function RecognitionBatch({
  batch,
  courses,
  locale,
  onLoad,
  onEnd,
}: {
  batch: ReturnType<typeof useRecognitionBatch>;
  courses: Course[];
  locale: string;
  onLoad: (courses: Course[]) => void;
  onEnd: () => void;
}) {
  const zh = locale.startsWith("zh"),
    text = (cn: string, en: string) => (zh ? cn : en);
  const { flow, state } = batch;
  if (state.phase === "idle" || state.phase === "ended") return null;
  const labels: Record<BatchItemStatus, string> = {
    preparing: text("待準備", "Preparing"),
    "prepare-error": text("準備失敗", "Preparation failed"),
    ready: text("未送出", "Not submitted"),
    running: text("處理中", "Processing"),
    succeeded: text("成功", "Succeeded"),
    failed: text("失敗", "Failed"),
    expired: text("已逾期", "Expired"),
    pending: text("尚待確認", "Pending confirmation"),
    skipped: text("已略過", "Skipped"),
    "storage-error": text(
      "線索保存失敗，尚未送出",
      "Not submitted: storage unavailable",
    ),
    "needs-confirmation": text(
      "舊線索需確認",
      "Old reference needs confirmation",
    ),
  };
  const busy = state.phase === "running";
  const missing = state.items.filter((i) => i.status !== "succeeded");
  return (
    <section
      aria-label={text("辨識批次", "Recognition batch")}
      className="my-4 rounded-xl border border-stone-200 bg-white p-4 text-sm"
    >
      <h3 className="font-semibold">{text("辨識批次", "Recognition batch")}</h3>
      <p className="mt-2 text-stone-600">
        {text(
          "每張圖片分別計算辨識工作。批次暫停不代表先前成功未扣次。",
          "Each image has its own job. Pausing does not undo successful jobs.",
        )}
      </p>
      <ul className="my-3 space-y-2">
        {state.items.map((item, index) => (
          <li key={item.id} className="rounded-lg bg-stone-50 p-3">
            <p>
              {index + 1}. {item.name} — <strong>{labels[item.status]}</strong>
            </p>
            {item.message && (
              <p role="status" className="mt-1 text-amber-700">
                {item.message}
              </p>
            )}
            <div className="mt-2 flex flex-wrap gap-4">
              {["failed", "expired", "storage-error", "prepare-error"].includes(
                item.status,
              ) && (
                <button
                  type="button"
                  disabled={busy}
                  className="underline"
                  onClick={() => void flow.retry(item.id)}
                >
                  {text("重試這張", "Retry this image")}
                </button>
              )}
              {item.status === "pending" && (
                <button
                  type="button"
                  disabled={busy}
                  className="underline"
                  onClick={() => void flow.check(item.id)}
                >
                  {text("重新查詢原工作", "Check original job")}
                </button>
              )}
              {item.status === "needs-confirmation" && (
                <button
                  type="button"
                  disabled={busy}
                  className="underline"
                  onClick={() => {
                    if (
                      window.confirm(
                        text(
                          "以新工作重新辨識，成功會再扣一次。請先確認最近辨識是否已有結果。確定繼續？",
                          "Start a new job? A successful recognition uses another credit. Check recent recognition first. Continue?",
                        ),
                      )
                    )
                      void flow.confirmNew(item.id, true);
                  }}
                >
                  {text("確認以新工作辨識", "Confirm new recognition job")}
                </button>
              )}
              {!["running", "succeeded", "skipped"].includes(item.status) && (
                <button
                  type="button"
                  disabled={busy}
                  className="underline"
                  onClick={() => flow.skip(item.id)}
                >
                  {text("略過這張", "Skip this image")}
                </button>
              )}
            </div>
          </li>
        ))}
      </ul>
      {state.overlap && (
        <p className="text-amber-700">
          {text(
            "候選結果有重疊時段，已完整保留，請檢查。",
            "Candidate results contain overlapping meetings. All distinct meetings are preserved; please review.",
          )}
        </p>
      )}
      {!!state.candidate.length && (
        <>
          {!!missing.length && (
            <p className="my-2 text-amber-700">
              {text("部分成功，尚缺：", "Partial result, missing: ")}
              {missing.map((i) => i.name).join("、")}
            </p>
          )}
          <button
            type="button"
            className="my-2 mr-4 rounded-full bg-indigo-600 px-4 py-2 text-white"
            onClick={() => {
              let result = flow.loadCandidate(courses.length > 0);
              if (
                result.status === "needs-confirmation" &&
                window.confirm(
                  text(
                    "載入本批次成功結果將取代目前課表，確定繼續？",
                    "Loading this batch replaces your current schedule. Continue?",
                  ),
                )
              )
                result = flow.loadCandidate(true, true);
              if (result.courses) onLoad(result.courses);
            }}
          >
            {text("載入本批次成功結果", "Load successful batch results")}
          </button>
        </>
      )}
      {!busy && state.items.some((i) => i.status === "ready") && (
        <button
          type="button"
          className="mr-4 underline"
          onClick={() => void flow.continue()}
        >
          {text("繼續剩餘圖片", "Continue remaining images")}
        </button>
      )}
      <button
        type="button"
        className="underline"
        onClick={() => {
          if (
            window.confirm(
              text(
                "結束後不再送出其餘圖片；已送出工作可能仍完成並扣次，結果可從最近辨識取回。確定結束？",
                "Stop this batch? Submitted jobs may still complete and use credits; retrieve them from recent recognition.",
              ),
            )
          ) {
            flow.end();
            onEnd();
          }
        }}
      >
        {text("結束這批", "End this batch")}
      </button>
    </section>
  );
}
