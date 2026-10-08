import { NextRequest, NextResponse } from "next/server";
import { readEntitlement, unlockWithPromo, usageResponse, withAccountId } from "@/lib/entitlement";
import { isPromoCode, normalizePromoCode } from "@/lib/promo";
import { getGoogleSession } from "@/lib/session";

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

  const code = normalizePromoCode(raw);
  const googleId = session.user.id || session.user.email || "";
  let entitlement = readEntitlement(request);
  if (googleId) entitlement = withAccountId(entitlement, googleId);

  const alreadyUsed = (entitlement.redeemedCodes ?? []).includes(code);
  if (!isPromoCode(code) || alreadyUsed) {
    return NextResponse.json({ error: "invalid" }, { status: 400 });
  }

  entitlement = unlockWithPromo(entitlement, code);
  return usageResponse(entitlement, { redeemed: true }, true);
}
