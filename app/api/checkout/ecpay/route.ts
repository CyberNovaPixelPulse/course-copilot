import { NextRequest, NextResponse } from "next/server";
import { attachEntitlement, PLAN_PRICE_TWD, readEntitlement, withAccountId } from "@/lib/entitlement";
import {
  checkMacValue as buildCheckMacValue,
  ecpayAutoSubmitHtml,
  merchantTradeDate,
  merchantTradeNo,
  ecpayActionUrl,
  credentialsForAction,
} from "@/lib/ecpay";
import { createPaymentOrder, reconcileEcpayEntitlement } from "@/lib/ecpay-orders";
import { getGoogleSession } from "@/lib/session";

export async function POST(request: NextRequest) {
  const googleSession = await getGoogleSession();
  if (!googleSession?.user) {
    return NextResponse.json(
      { error: "Sign in with Google before paying with ECPay.", requiresAuth: true },
      { status: 401 },
    );
  }

  const action = ecpayActionUrl();
  const keys = credentialsForAction(action);
  if (!keys) return NextResponse.json({ error: "綠界付款尚未設定完成。" }, { status: 503 });
  const origin = new URL(process.env.NEXTAUTH_URL || request.nextUrl.origin).origin;
  const tradeNo = merchantTradeNo();

  const googleId = googleSession.user.id || googleSession.user.email || "";
  let entitlement = readEntitlement(request);
  if (googleId) entitlement = withAccountId(entitlement, googleId);
  entitlement = await reconcileEcpayEntitlement(entitlement);

  const params: Record<string, string> = {
    MerchantID: keys.merchantId,
    MerchantTradeNo: tradeNo,
    MerchantTradeDate: merchantTradeDate(),
    PaymentType: "aio",
    TotalAmount: String(PLAN_PRICE_TWD),
    TradeDesc: "CourseCopilot",
    ItemName: "CourseCopilot 30 Credits",
    ReturnURL: `${origin}/api/webhooks/ecpay`,
    ClientBackURL: `${origin}/?ecpay_order=${tradeNo}`,
    OrderResultURL: `${origin}/api/checkout/ecpay/return`,
    ChoosePayment: "ALL",
    EncryptType: "1",
  };
  const checkMacValue = buildCheckMacValue(params, keys.hashKey, keys.hashIv);
  params.CheckMacValue = checkMacValue;

  try {
    await createPaymentOrder(tradeNo, entitlement, keys.merchantId, action);
  } catch {
    return NextResponse.json({ error: "暫時無法建立付款訂單，請稍後再試。" }, { status: 503 });
  }

  const response = new NextResponse(ecpayAutoSubmitHtml(action, params), {
    headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" },
  });
  attachEntitlement(response, entitlement);
  return response;
}
