import { getTurso } from "./turso";

async function returnLinks() {
  const db = getTurso();
  await db.execute(`CREATE TABLE IF NOT EXISTS cc_checkout_return_links (
    attempt_id TEXT PRIMARY KEY, account_id TEXT NOT NULL, session_id TEXT NOT NULL
  )`);
  return db;
}

// This is a return lookup, never payment evidence or a grant source.
export async function saveCheckoutReturnLink(
  attemptId: string,
  accountId: string,
  sessionId: string,
) {
  const db = await returnLinks();
  // A reused untrusted attempt ID must not redirect an older return to a new payment.
  await db.execute({
    sql: "INSERT INTO cc_checkout_return_links(attempt_id,account_id,session_id) VALUES (?,?,?)",
    args: [attemptId, accountId, sessionId],
  });
}

export async function checkoutReturnSession(
  attemptId: string,
  accountId: string,
) {
  const db = await returnLinks();
  const result = await db.execute({
    sql: "SELECT account_id,session_id FROM cc_checkout_return_links WHERE attempt_id=?",
    args: [attemptId],
  });
  const row = result.rows[0];
  if (!row || row.account_id !== accountId) return null;
  return String(row.session_id);
}
