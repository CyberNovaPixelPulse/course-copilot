import { NextRequest, NextResponse } from "next/server";
import Stripe from "stripe";
import { markPaid, readEntitlement, usageResponse, withAccountId } from "@/lib/entitlement";
import { getGoogleSession } from "@/lib/session";

export async function GET(request: NextRequest) {
  const sessionId = request.nextUrl.searchParams.get("session_id");
  if (!sessionId) {
    return NextResponse.json({ error: "Missing session_id." }, { status: 400 });
  }

  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) {
    return NextResponse.json(
      { error: "Stripe is not configured. Add STRIPE_SECRET_KEY to .env.local." },
      { status: 503 },
    );
  }

  const stripe = new Stripe(key);
  const session = await stripe.checkout.sessions.retrieve(sessionId);
  if (session.payment_status !== "paid" && session.status !== "complete") {
    return NextResponse.json({ error: "Payment is not complete yet." }, { status: 402 });
  }

  const googleSession = await getGoogleSession();
  if (!googleSession?.user) {
    return NextResponse.json(
      { error: "Sign in with Google to activate the paid plan.", requiresAuth: true },
      { status: 401 },
    );
  }

  const googleId = googleSession.user.id || googleSession.user.email || "";
  let entitlement = readEntitlement(request);
  if (googleId) entitlement = withAccountId(entitlement, googleId);
  entitlement = markPaid(entitlement);
  return usageResponse(entitlement, { paid: true }, true);
}
