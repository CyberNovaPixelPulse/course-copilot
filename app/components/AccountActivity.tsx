"use client";
import { useState, useEffect, useCallback } from "react";
import type { Course } from "@/lib/types";
type Job = {
  id: string;
  state: string;
  createdAt: number;
  courses: Course[] | null;
};
type Review = { id: string; status: string; reason: string | null };
export default function AccountActivity({
  restore,
}: {
  restore: (courses: Course[]) => void;
}) {
  const [jobs, setJobs] = useState<Job[]>([]),
    [reviews, setReviews] = useState<Review[]>([]);
  const [error, setError] = useState(""),
    [evidence, setEvidence] = useState(""),
    [busy, setBusy] = useState(false);
  const load = useCallback(async (signal?: AbortSignal) => {
    const [j, r] = await Promise.all([
      fetch("/api/recognition/jobs", { signal }),
      fetch("/api/account/reviews", { signal }),
    ]);
    if (!j.ok || !r.ok) throw new Error("暫時無法讀取帳號紀錄，請稍後重試。");
    const [jd, rd] = await Promise.all([j.json(), r.json()]);
    if (!signal?.aborted) {
      setJobs(jd.jobs);
      setReviews(rd.reviews);
      setError("");
    }
  }, []);
  useEffect(() => {
    const c = new AbortController();
    queueMicrotask(() => {
      if (!c.signal.aborted) void load(c.signal).catch((e) => {
        if (!c.signal.aborted) setError(e.message);
      });
    });
    return () => c.abort();
  }, [load]);
  async function submit() {
    setBusy(true);
    setError("");
    try {
      const legacy = window.localStorage.getItem("cc_entitlement_token");
      const response = await fetch("/api/account/reviews", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          evidence:
            evidence.trim() + (legacy ? "\n舊憑證（僅供核對）：" + legacy : ""),
        }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "提交失敗，請稍後重試。");
      setReviews(data.reviews);
      setEvidence("");
    } catch (e) {
      setError(e instanceof Error ? e.message : "提交失敗。");
    } finally {
      setBusy(false);
    }
  }
  const labels: Record<string, string> = {
    running: "辨識中",
    succeeded: "已完成",
    failed: "失敗，未扣次",
    expired: "已逾期，未扣次",
  };
  return (
    <div className="mb-6 space-y-3 rounded-2xl border border-stone-200 bg-white p-4">
      <details>
        <summary className="cursor-pointer font-medium">
          最近辨識（7 天內）
        </summary>
        <button
          type="button"
          className="my-3 underline"
          onClick={() => void load().catch((e) => setError(e.message))}
        >
          重新整理紀錄
        </button>
        {jobs.length === 0 && (
          <p className="text-sm text-stone-600">尚無近期辨識。</p>
        )}
        <ul className="space-y-2">
          {jobs.map((job) => (
            <li
              key={job.id}
              className="flex flex-wrap items-center justify-between gap-3 border-t py-2 text-sm"
            >
              <span>
                {new Date(job.createdAt).toLocaleString()} ·{" "}
                {labels[job.state] || job.state}
              </span>
              {job.courses && (
                <button
                  type="button"
                  className="rounded-lg border px-3 py-1"
                  onClick={() => {
                    if (
                      window.confirm(
                        "載入此辨識結果將取代畫面上的課表，是否繼續？",
                      )
                    )
                      restore(job.courses!);
                  }}
                >
                  恢復課程
                </button>
              )}
            </li>
          ))}
        </ul>
      </details>
      <details>
        <summary className="cursor-pointer font-medium">舊權益核對</summary>
        <p className="my-2 text-sm text-stone-600">
          舊額度未恢復時，請提供付款編號、優惠碼及說明。請勿提供卡號或密碼。
        </p>
        <label className="block text-sm" htmlFor="review-evidence">
          核對資訊
        </label>
        <textarea
          id="review-evidence"
          className="my-2 w-full rounded-lg border p-2"
          maxLength={8000}
          value={evidence}
          onChange={(e) => setEvidence(e.target.value)}
        />
        <button
          type="button"
          className="rounded-lg border px-3 py-2 disabled:opacity-50"
          disabled={busy || !evidence.trim()}
          onClick={() => void submit()}
        >
          {busy ? "提交中…" : "提交核對請求"}
        </button>
        <ul className="mt-3 text-sm">
          {reviews.map((r) => (
            <li key={r.id}>
              {r.status === "pending" ? "待核對" : "已處理"}
              {r.reason ? " · " + r.reason : ""}
            </li>
          ))}
        </ul>
      </details>
      {error && (
        <p role="alert" className="text-sm text-red-700">
          {error}
        </p>
      )}
    </div>
  );
}
