import { NextResponse } from "next/server";
import { getRateSnapshot } from "@/lib/currency";

export async function GET() {
  try {
    const snapshot = await getRateSnapshot();
    const maxAge = Math.max(0, Math.floor((snapshot.expiresAt - Date.now()) / 1000));
    return NextResponse.json(snapshot, {
      headers: { "Cache-Control": `public, max-age=${maxAge}` },
    });
  } catch {
    return NextResponse.json({ error: "Could not load exchange rates." }, { status: 502 });
  }
}
