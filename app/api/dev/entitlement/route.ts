import { NextResponse } from "next/server";

// Legacy entitlement previews must not mutate cookies or feed real account displays.
export async function POST() {
  return NextResponse.json(
    { error: "Entitlement preview is disabled." },
    { status: 404 },
  );
}
