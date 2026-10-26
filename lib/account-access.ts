import { NextResponse } from "next/server";
import { getGoogleSession } from "./session";
import { getTurso } from "./turso";
import {
  createAccountEntitlements,
  AccountError,
} from "./account-entitlements";
import { ensurePaymentTables } from "./ecpay-orders";
import type { Client } from "@libsql/client";

const stores = new WeakMap<
  Client,
  ReturnType<typeof createAccountEntitlements>
>();
export function accountStore() {
  const db = getTurso();
  let store = stores.get(db);
  if (!store) {
    store = createAccountEntitlements(db);
    stores.set(db, store);
  }
  return store;
}
export async function signedInAccount() {
  const session = await getGoogleSession();
  const id = session?.user?.id || session?.user?.email;
  if (!id) throw new AccountError("auth", 401);
  return id;
}
export async function accountUsage(id: string) {
  await ensurePaymentTables();
  const store = accountStore();
  await store.importEcpay(id);
  const usage = await store.usage(id);
  return {
    stripeCheckoutEnabled: Boolean(process.env.STRIPE_SECRET_KEY),
    userId: id,
    paid: usage.canExport,
    canExportIcs: usage.canExport,
    gpt4oRemaining: usage.creditRemaining,
    freeScansRemaining: usage.freeRemaining,
    remaining: usage.remaining,
    parseCount: 0,
    gpt4oCount: 0,
    model: "gpt-4o" as const,
    token: "",
  };
}
export async function accountResponse(
  id: string,
  extra: Record<string, unknown> = {},
) {
  const usage = await accountUsage(id);
  return NextResponse.json(
    { ...usage, ...extra, usage },
    { headers: { "Cache-Control": "no-store" } },
  );
}
const messages: Record<string, string> = {
  auth: "請先登入 Google。",
  insufficient_credits: "辨識額度不足，請補充額度。",
  job_expired: "辨識工作已結束且未扣次，請重新送出。",
  job_conflict: "此辨識工作與圖片不符，請重新送出。",
  payment_pending: "付款仍在確認中，請勿重複付款。",
  payment_review_required: "付款需要核對，請提出權益核對請求。",
  inactive: "優惠碼無效。",
  expired: "優惠碼已過期。",
  limit: "優惠碼名額已用完。",
};
export function accountFailure(error: unknown) {
  if (error instanceof AccountError)
    return NextResponse.json(
      {
        error: messages[error.code] || error.code,
        code: error.code,
        requiresAuth: error.status === 401,
        requiresPayment: error.code === "insufficient_credits",
      },
      { status: error.status, headers: { "Cache-Control": "no-store" } },
    );
  console.error(
    "Account operation failed",
    error instanceof Error ? error.message : "unknown",
  );
  return NextResponse.json(
    {
      error: "暫時無法驗證帳號權益，請稍後重試，無須再次付款。",
      code: "account_unavailable",
    },
    { status: 503, headers: { "Cache-Control": "no-store" } },
  );
}
