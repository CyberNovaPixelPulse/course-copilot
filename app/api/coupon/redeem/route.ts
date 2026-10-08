import { NextRequest, NextResponse } from "next/server";
import {
  couponRejectionMessage,
  normalizeCouponCode,
  redeemCoupon,
  type CouponRejection,
} from "@/lib/coupons";
import {
  readEntitlement,
  toUsagePublic,
  unlockWithPromo,
  usageResponse,
  withAccountId,
} from "@/lib/entitlement";
import { getGoogleSession } from "@/lib/session";

const AUTH_MESSAGE = "請先登入 Google 帳號後再進行兌換";

function reject(reason: CouponRejection) {
  return NextResponse.json(
    { error: reason, message: couponRejectionMessage(reason) },
    { status: 400 },
  );
}

function unavailable() {
  return NextResponse.json(
    { error: "unavailable", message: "優惠碼暫時無法兌換，請稍後再試。" },
    { status: 503 },
  );
}

export async function POST(request: NextRequest) {
  let session: Awaited<ReturnType<typeof getGoogleSession>> = null;
  try {
    session = await getGoogleSession();
  } catch (error) {
    console.error("兌換失敗原因:", error);
    session = null;
  }
  if (!session?.user) {
    return NextResponse.json(
      { error: "auth", message: AUTH_MESSAGE, requiresAuth: true },
      { status: 401 },
    );
  }

  let raw = "";
  try {
    const body = (await request.json()) as { code?: unknown };
    if (typeof body.code === "string") raw = body.code;
  } catch {
    raw = "";
  }

  const code = normalizeCouponCode(raw);
  if (!code) return reject("inactive");

  const googleId = session.user.id || session.user.email || "";
  let entitlement = readEntitlement(request);
  if (googleId) entitlement = withAccountId(entitlement, googleId);

  const alreadyUsed = (entitlement.redeemedCodes ?? []).some(
    (used) => normalizeCouponCode(used) === code,
  );
  if (alreadyUsed) return reject("limit");

  try {
    const redeemed = await redeemCoupon(code);
    if ("reason" in redeemed) return reject(redeemed.reason);

    entitlement = unlockWithPromo(entitlement, redeemed.code);
    const usage = toUsagePublic(entitlement, true);
    return usageResponse(
      entitlement,
      { redeemed: true, isPaid: true, remainingCredits: usage.gpt4oRemaining },
      true,
    );
  } catch (error) {
    console.error("兌換失敗原因:", error);
    return unavailable();
  }
}
