import { NextRequest, NextResponse } from "next/server";
import { timingSafeEqual } from "crypto";
import { accountStore, accountFailure } from "@/lib/account-access";
export async function GET(request: NextRequest) {
  const expected = process.env.CRON_SECRET;
  const supplied = request.headers.get("authorization") || "";
  if (
    !expected ||
    Buffer.byteLength(supplied) !== Buffer.byteLength(`Bearer ${expected}`) ||
    !timingSafeEqual(Buffer.from(supplied), Buffer.from(`Bearer ${expected}`))
  )
    return new NextResponse(null, { status: 401 });
  try {
    await accountStore().cleanup();
    return NextResponse.json({ ok: true });
  } catch (e) {
    return accountFailure(e);
  }
}
