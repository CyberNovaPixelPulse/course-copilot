import { createClient, type Client } from "@libsql/client";
import { randomUUID } from "crypto";

export type AiUsageLog = {
  siteId: string;
  model: string;
  inputTokens: number;
  outputTokens: number;
  latencyMs: number;
  status: string;
  metadata?: Record<string, unknown>;
};

let client: Client | null = null;

export function getTurso(): Client {
  if (client) return client;
  const url = process.env.TURSO_DATABASE_URL?.trim();
  const authToken = process.env.TURSO_AUTH_TOKEN?.trim();
  if (!url || !authToken) {
    console.error("[Turso Env Error] 找不到環境變數");
    throw new Error("Missing TURSO_DATABASE_URL or TURSO_AUTH_TOKEN.");
  }
  client = createClient({ url, authToken });
  return client;
}

async function insertAiLog(entry: AiUsageLog) {
  await getTurso().execute({
    sql: `INSERT INTO ai_logs (
            id, site_id, model, input_tokens, output_tokens, latency_ms, status, metadata
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    args: [
      randomUUID(),
      entry.siteId,
      entry.model,
      entry.inputTokens,
      entry.outputTokens,
      entry.latencyMs,
      entry.status,
      JSON.stringify(entry.metadata ?? {}),
    ],
  });
}

/** Writes one AI call and waits until Turso accepts it. */
export async function logAiUsage(entry: AiUsageLog) {
  await insertAiLog(entry);
}

/** Recognition-specific adapter; unknown usage must not be converted to zero. */
export async function logRecognitionUsage(
  entry: import("./parse-schedule").RecognitionRecord,
) {
  await getTurso().execute(`CREATE TABLE IF NOT EXISTS cc_recognition_logs (
    account_id TEXT NOT NULL, job_id TEXT NOT NULL, model TEXT NOT NULL, input_tokens INTEGER, output_tokens INTEGER,
    latency_ms INTEGER NOT NULL, model_status TEXT NOT NULL, normalization_status TEXT NOT NULL,
    failure_code TEXT, course_count INTEGER NOT NULL, event_count INTEGER NOT NULL, credit_bucket TEXT NOT NULL, PRIMARY KEY(account_id,job_id)
  )`);
  const record = {
    sql: `INSERT INTO cc_recognition_logs(account_id,job_id,model,input_tokens,output_tokens,latency_ms,model_status,normalization_status,failure_code,course_count,event_count,credit_bucket) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,
    args: [
      entry.accountId,
      entry.jobId,
      entry.model,
      entry.inputTokens,
      entry.outputTokens,
      entry.latencyMs,
      entry.modelStatus,
      entry.normalizationStatus,
      entry.failureCode,
      entry.courseCount,
      entry.eventCount,
      entry.creditBucket,
    ],
  };
  // Existing numeric-only consumers keep receiving known usage. Unknown usage
  // lives in the nullable recognition log instead of being fabricated as zero.
  if (entry.inputTokens !== null && entry.outputTokens !== null) {
    await getTurso().batch(
      [
        record,
        {
          sql: `INSERT INTO ai_logs(id,site_id,model,input_tokens,output_tokens,latency_ms,status,metadata) VALUES (?,?,?,?,?,?,?,?)`,
          args: [
            randomUUID(),
            "course-copilot",
            entry.model,
            entry.inputTokens,
            entry.outputTokens,
            entry.latencyMs,
            entry.modelStatus === "responded" ? "success" : "error",
            JSON.stringify({
              account_id: entry.accountId,
              job_id: entry.jobId,
              task_id: entry.jobId,
              step: 1,
              stage: "courses",
              payment_type:
                entry.creditBucket === "free" ? "free" : "account_credit",
              fee_charged_twd: 0,
              coupon_code: null,
              normalization_status: entry.normalizationStatus,
              failure_code: entry.failureCode,
              credit_bucket: entry.creditBucket,
              events_count: entry.eventCount,
            }),
          ],
        },
      ],
      "write",
    );
  } else await getTurso().execute(record);
}
