import { NextRequest, NextResponse } from "next/server";
import { getGoogleSession } from "@/lib/session";
import { getTurso } from "@/lib/turso";
import { readEntitlement, usageResponse, withAccountId } from "@/lib/entitlement";
import { reconcileEcpayEntitlement } from "@/lib/ecpay-orders";

export async function GET(request: NextRequest) {
  const session = await getGoogleSession();
  const accountId = session?.user?.id || session?.user?.email;
  if (!accountId) return NextResponse.json({ error: "請先登入 Google。" }, { status: 401 });
  const result = await getTurso().execute({
    sql: "SELECT paid_at FROM cc_ecpay_orders WHERE trade_no = ? AND account_id = ?",
    args: [request.nextUrl.searchParams.get("order") ?? "", accountId],
  });
  if (!result.rows[0]) return NextResponse.json({ error: "找不到此付款訂單。" }, { status: 404 });
  const entitlement = await reconcileEcpayEntitlement(withAccountId(readEntitlement(request), accountId));
  const response = usageResponse(entitlement, { paymentStatus: result.rows[0].paid_at == null ? "pending" : "paid" }, true);
  response.headers.set("Cache-Control", "no-store");
  return response;
}
