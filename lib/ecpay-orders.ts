import { getTurso } from "@/lib/turso";
import { GPT4O_CAP, PLAN_PRICE_TWD, type Entitlement } from "@/lib/entitlement";
import { credentialsForAction, validCheckMacValue } from "@/lib/ecpay";

let schemaReady: Promise<unknown> | undefined;

export async function ensurePaymentTables() {
  schemaReady ??= getTurso().batch([
    `CREATE TABLE IF NOT EXISTS cc_ecpay_orders (
      trade_no TEXT PRIMARY KEY, account_id TEXT NOT NULL, merchant_id TEXT NOT NULL,
      action_url TEXT NOT NULL, amount INTEGER NOT NULL, initial_entitlement TEXT NOT NULL,
      created_at INTEGER NOT NULL, paid_at INTEGER, gateway_trade_no TEXT UNIQUE
    )`,
    `CREATE INDEX IF NOT EXISTS cc_ecpay_orders_account ON cc_ecpay_orders(account_id, paid_at)`,
    `CREATE TABLE IF NOT EXISTS cc_ecpay_usage (account_id TEXT PRIMARY KEY, used_count INTEGER NOT NULL DEFAULT 0)`,
  ], "write").catch((error) => { schemaReady = undefined; throw error; });
  await schemaReady;
}

export async function createPaymentOrder(tradeNo: string, entitlement: Entitlement, merchantId: string, action: string) {
  await ensurePaymentTables();
  await getTurso().execute({
    sql: `INSERT INTO cc_ecpay_orders (trade_no, account_id, merchant_id, action_url, amount, initial_entitlement, created_at)
          VALUES (?, ?, ?, ?, ?, ?, ?)`,
    args: [tradeNo, entitlement.userId, merchantId, action, PLAN_PRICE_TWD, JSON.stringify(entitlement), Date.now()],
  });
}

export async function acceptPaymentNotification(params: Record<string, string>) {
  const result = await getTurso().execute({ sql: "SELECT * FROM cc_ecpay_orders WHERE trade_no = ?", args: [params.MerchantTradeNo ?? ""] });
  const order = result.rows[0];
  if (!order) return false;
  const keys = credentialsForAction(String(order.action_url));
  if (!keys || params.MerchantID !== String(order.merchant_id) ||
      params.MerchantID !== keys.merchantId || !validCheckMacValue(params, keys.hashKey, keys.hashIv) ||
      params.TradeAmt !== String(order.amount)) return false;
  // Acknowledge signed failures and simulated callbacks, but never grant access.
  if (params.RtnCode !== "1" || params.SimulatePaid !== "0") return true;
  if (!params.TradeNo) return false;
  if (order.paid_at != null) return params.TradeNo === String(order.gateway_trade_no);
  await getTurso().execute({
    sql: "UPDATE cc_ecpay_orders SET paid_at = ?, gateway_trade_no = ? WHERE trade_no = ? AND paid_at IS NULL",
    args: [Date.now(), params.TradeNo, params.MerchantTradeNo],
  });
  return true;
}

export async function reconcileEcpayEntitlement(entitlement: Entitlement): Promise<Entitlement> {
  await ensurePaymentTables();
  const result = await getTurso().execute({
    sql: "SELECT initial_entitlement, paid_at FROM cc_ecpay_orders WHERE account_id = ? AND paid_at IS NOT NULL ORDER BY created_at, trade_no",
    args: [entitlement.userId],
  });
  if (result.rows.length === 0) return entitlement;
  const initial = JSON.parse(String(result.rows[0].initial_entitlement)) as Entitlement;
  const current = entitlement.paid && (!entitlement.ecpayAccountId || entitlement.ecpayAccountId === entitlement.userId)
    ? entitlement : { ...initial, userId: entitlement.userId };
  const credits = result.rows.length * GPT4O_CAP;
  const usage = await getTurso().execute({
    sql: `INSERT INTO cc_ecpay_usage (account_id, used_count) VALUES (?, ?)
          ON CONFLICT(account_id) DO UPDATE SET used_count = MAX(used_count, excluded.used_count)
          RETURNING used_count`,
    args: [entitlement.userId, current.gpt4oCount],
  });
  return {
    ...current,
    paid: true,
    paidAt: current.paidAt ?? Number(result.rows[0].paid_at),
    unlockMethod: "paid",
    gpt4oCount: Number(usage.rows[0].used_count),
    bonusCredits: (current.bonusCredits ?? 0) - (current.ecpayCredits ?? 0) + credits - (current.paid ? 0 : GPT4O_CAP),
    ecpayCredits: credits,
    ecpayAccountId: entitlement.userId,
  };
}

export async function recordEcpayUsage(entitlement: Entitlement): Promise<Entitlement> {
  if (!entitlement.ecpayCredits) return entitlement;
  const result = await getTurso().execute({
    sql: "UPDATE cc_ecpay_usage SET used_count = used_count + 1 WHERE account_id = ? RETURNING used_count",
    args: [entitlement.userId],
  });
  if (!result.rows[0]) throw new Error("Missing payment usage record.");
  return { ...entitlement, gpt4oCount: Number(result.rows[0].used_count) };
}
