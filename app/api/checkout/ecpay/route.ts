import { NextRequest, NextResponse } from "next/server";
import { attachEntitlement, PLAN_PRICE_TWD, readEntitlement, withAccountId } from "@/lib/entitlement";
import {
  checkMacValue as buildCheckMacValue,
  ecpayAutoSubmitHtml,
  merchantTradeDate,
  merchantTradeNo,
} from "@/lib/ecpay";
import { getGoogleSession } from "@/lib/session";

const ECPAY_ACTION = "https://payment.ecpay.com.tw/Cashier/AioCheckOut/V5";
const ECPAY_KEYS = {
  merchantId: "3516624",
  hashKey: "z1b9okzZCrggFURI",
  hashIv: "C09P62rs2NnOTlHz",
};

export async function POST(request: NextRequest) {
  const googleSession = await getGoogleSession();
  if (!googleSession?.user) {
    return NextResponse.json(
      { error: "Sign in with Google before paying with ECPay.", requiresAuth: true },
      { status: 401 },
    );
  }

  const action = ECPAY_ACTION;
  const keys = ECPAY_KEYS;

  const googleId = googleSession.user.id || googleSession.user.email || "";
  let entitlement = readEntitlement(request);
  if (googleId) entitlement = withAccountId(entitlement, googleId);

  const params: Record<string, string> = {
    MerchantID: keys.merchantId,
    MerchantTradeNo: merchantTradeNo(),
    MerchantTradeDate: merchantTradeDate(),
    PaymentType: "aio",
    TotalAmount: String(PLAN_PRICE_TWD),
    TradeDesc: "CourseCopilot",
    ItemName: "CourseCopilot 30 Credits",
    ReturnURL: "https://ics.necterelux.com/api/webhooks/ecpay",
    ChoosePayment: "ALL",
    EncryptType: "1",
  };
  const checkMacValue = buildCheckMacValue(params, keys.hashKey, keys.hashIv);
  params.CheckMacValue = checkMacValue;

  console.log("=== [ECPAY DEBUG] 送往綠界的完整參數 ===");
  console.log("Action URL:", action);
  console.log(JSON.stringify(params, null, 2));
  console.log("MerchantTradeNo 長度:", params.MerchantTradeNo?.length);
  console.log("CheckMacValue:", checkMacValue);
  console.log("=====================================");

  const response = new NextResponse(ecpayAutoSubmitHtml(action, params), {
    headers: { "Content-Type": "text/html; charset=utf-8" },
  });
  attachEntitlement(response, entitlement);
  return response;
}
