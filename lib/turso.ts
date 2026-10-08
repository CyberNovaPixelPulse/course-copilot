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
  const url = process.env.TURSO_DATABASE_URL;
  const authToken = process.env.TURSO_AUTH_TOKEN;
  if (!url || !authToken) {
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

/** Writes one AI call in the background. Failures are logged and do not reject. */
export function logAiUsage(entry: AiUsageLog) {
  void (async () => {
    try {
      await insertAiLog(entry);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.warn(`[turso] ai log write failed: ${message}`);
    }
  })();
}
