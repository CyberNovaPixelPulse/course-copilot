import { NextRequest, NextResponse } from "next/server";
import {
  accountStore,
  signedInAccount,
  accountFailure,
} from "@/lib/account-access";
import { AccountError } from "@/lib/account-entitlements";
export async function GET() {
  try {
    return NextResponse.json(
      { reviews: await accountStore().reviews(await signedInAccount()) },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (e) {
    return accountFailure(e);
  }
}
export async function POST(request: NextRequest) {
  try {
    const id = await signedInAccount();
    const body = (await request.json()) as { evidence?: unknown };
    if (
      typeof body.evidence !== "string" ||
      !body.evidence.trim() ||
      body.evidence.length > 12000
    )
      throw new AccountError("invalid_evidence", 400);
    return NextResponse.json(
      { reviews: await accountStore().requestReview(id, body.evidence.trim()) },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (e) {
    return accountFailure(e);
  }
}
