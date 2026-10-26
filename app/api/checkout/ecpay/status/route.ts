import { NextRequest, NextResponse } from "next/server";
import { getGoogleSession } from "@/lib/session";
import { getTurso } from "@/lib/turso";
import {
  accountResponse,
  accountFailure,
  accountUsage,
} from "@/lib/account-access";

export async function GET(request: NextRequest) {
  const session = await getGoogleSession();
  const accountId = session?.user?.id || session?.user?.email;
  if (!accountId)
    return NextResponse.json({ error: "請先登入 Google。" }, { status: 401 });
  try {
    await accountUsage(accountId);
    const result = await getTurso().execute({
      sql: "SELECT paid_at FROM cc_ecpay_orders WHERE trade_no = ? AND account_id = ?",
      args: [request.nextUrl.searchParams.get("order") ?? "", accountId],
    });
    if (!result.rows[0])
      return NextResponse.json(
        { error: "找不到此付款訂單。" },
        { status: 404 },
      );
    const response = await accountResponse(accountId, {
      paymentStatus: result.rows[0].paid_at == null ? "pending" : "paid",
    });
    response.headers.set("Cache-Control", "no-store");
    return response;
  } catch (e) {
    return accountFailure(e);
  }
}
