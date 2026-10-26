import { NextRequest } from "next/server";
import {
  accountStore,
  accountResponse,
  signedInAccount,
  accountFailure,
} from "@/lib/account-access";
import { AccountError } from "@/lib/account-entitlements";
import { normalizeCouponCode, COUPON_SITE_ID } from "@/lib/coupons";
export async function POST(request: NextRequest) {
  try {
    const id = await signedInAccount();
    const body = (await request.json()) as {
      code?: unknown;
      site_id?: unknown;
    };
    if (body.site_id !== undefined && body.site_id !== COUPON_SITE_ID)
      throw new AccountError("inactive", 400);
    const code =
      typeof body.code === "string" ? normalizeCouponCode(body.code) : "";
    if (!code || code.length > 100) throw new AccountError("inactive", 400);
    await accountStore().redeem(id, code);
    return await accountResponse(id, { redeemed: true, isPaid: true });
  } catch (e) {
    return accountFailure(e);
  }
}
