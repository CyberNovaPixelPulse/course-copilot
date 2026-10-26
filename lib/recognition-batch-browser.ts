import { createRecognitionBatch, type JobOutcome } from "./recognition-batch";
import type { createEntitlementDisplay } from "./entitlement-display";
import type { Course } from "./types";
export function createBrowserRecognitionBatch(
  accountId: string,
  entitlements: ReturnType<typeof createEntitlementDisplay>,
) {
  return createRecognitionBatch(accountId, {
    storage: {
      getItem: (k) => window.localStorage.getItem(k),
      setItem: (k, v) => window.localStorage.setItem(k, v),
      removeItem: (k) => window.localStorage.removeItem(k),
    },
    now: Date.now,
    id: () => crypto.randomUUID(),
    fingerprint: async (image) =>
      Array.from(
        new Uint8Array(
          await crypto.subtle.digest("SHA-256", await image.arrayBuffer()),
        ),
      )
        .map((b) => b.toString(16).padStart(2, "0"))
        .join(""),
    beginOperation: () => entitlements.beginOperation(),
    async submit(image, jobId, signal): Promise<JobOutcome> {
      const form = new FormData();
      form.append("image", image, "schedule.png");
      form.append("jobId", jobId);
      const response = await fetch("/api/parse-schedule", {
        method: "POST",
        body: form,
        signal,
      });
      const data = await response.json();
      if (response.status === 401)
        return {
          state: "auth",
          status: 401,
          message: "請登入原帳號後查看最近辨識。",
        };
      if (response.status === 402)
        return {
          state: "payment",
          status: 402,
          usage: data.usage,
          message: "辨識額度不足。請補充額度後明確重試。",
        };
      if (response.ok && response.status !== 202)
        return {
          state: "succeeded",
          courses: data.courses,
          usage: data.usage,
          status: response.status,
        };
      if (response.status === 202)
        return { state: "pending", usage: data.usage, status: 202 };
      if (data.state === "expired" || data.code === "job_expired")
        return { state: "expired", usage: data.usage, status: response.status };
      if (
        response.status === 422 ||
        data.state === "failed" ||
        ["job_conflict", "inactive"].includes(data.code)
      )
        return {
          state: "failed",
          usage: data.usage,
          status: response.status,
          message: "此圖片辨識失敗，未取得可用結果。可明確重試這張。",
        };
      // Other failures can occur after the server completed; consult the same job.
      throw new Error("Submission outcome unknown");
    },
    async query(jobId, signal): Promise<JobOutcome> {
      const response = await fetch(
        `/api/recognition/jobs?id=${encodeURIComponent(jobId)}`,
        { signal, cache: "no-store" },
      );
      if (response.status === 401)
        return {
          state: "auth",
          status: 401,
          message: "請登入原帳號後查看最近辨識。",
        };
      if (!response.ok) throw new Error("Job status unavailable");
      const data = await response.json();
      const job = Array.isArray(data.jobs)
        ? data.jobs.find((j: { id?: unknown }) => j.id === jobId)
        : undefined;
      if (!job) return { state: "not-found" };
      if (job.state === "succeeded" && job.courses)
        return { state: "succeeded", courses: job.courses as Course[] };
      if (job.state === "failed" || job.state === "expired")
        return { state: job.state };
      return { state: "pending" };
    },
  });
}
