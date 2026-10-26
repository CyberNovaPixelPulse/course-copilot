import { NextRequest, NextResponse } from "next/server";
import {
  accountStore,
  signedInAccount,
  accountFailure,
} from "@/lib/account-access";
export async function GET(request: NextRequest) {
  try {
    const id = await signedInAccount();
    return NextResponse.json(
      {
        jobs: await accountStore().jobs(
          id,
          request.nextUrl.searchParams.get("id") || undefined,
        ),
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (e) {
    return accountFailure(e);
  }
}
