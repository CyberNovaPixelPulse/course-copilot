import { NextRequest, NextResponse } from "next/server";
import {
  couponRejectionMessage,
  findActiveCoupon,
  incrementCouponUse,
  rejectCoupon,
  type CouponRejection,
} from "@/lib/coupons";
import { readEntitlement, unlockWithPromo, usageResponse, withAccountId } from "@/lib/entitlement";
import { getGoogleSession } from "@/lib/session";

function reject(reason: CouponRejection) {
  return NextResponse.json(
    { error: reason, message: couponRejectionMessage(reason) },
    { status: 400 },
  );
}

export async function POST(request: NextRequest) {
  const session = await getGoogleSession();
  if (!session?.user) {
    return NextResponse.json(
      { error: "Sign in with Google before redeeming a code.", requiresAuth: true },
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

  const code = raw.trim();
  if (!code) return reject("inactive");

  const googleId = session.user.id || session.user.email || "";
  let entitlement = readEntitlement(request);
  if (googleId) entitlement = withAccountId(entitlement, googleId);

  const alreadyUsed = (entitlement.redeemedCodes ?? []).some(
    (used) => used.trim().toUpperCase() === code.toUpperCase(),
  );
  if (alreadyUsed) return reject("limit");

  try {
    const coupon = await findActiveCoupon(code);
    if (!coupon) return reject("inactive");
    const reason = rejectCoupon(coupon);
    if (reason) return reject(reason);

    await incrementCouponUse(coupon.id);
    entitlement = unlockWithPromo(entitlement, coupon.code || code);
    return usageResponse(entitlement, { redeemed: true }, true);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.warn(`[coupon] redeem failed: ${message}`);
    return NextResponse.json(
      { error: "unavailable", message: "優惠碼暫時無法兌換，請稍後再試。" },
      { status: 503 },
    );
  }
}
