import { NextRequest, NextResponse } from "next/server";
import Stripe from "stripe";
import { PLAN_PRICE_TWD, readEntitlement, usageResponse, withAccountId } from "@/lib/entitlement";
import { getGoogleSession } from "@/lib/session";

function stripeClient() {
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) return null;
  return new Stripe(key);
}

export async function POST(request: NextRequest) {
  const googleSession = await getGoogleSession();
  if (!googleSession?.user) {
    return NextResponse.json(
      { error: "Sign in with Google to unlock the NT$33 plan.", requiresAuth: true },
      { status: 401 },
    );
  }

  const stripe = stripeClient();
  if (!stripe) {
    return NextResponse.json(
      { error: "Stripe is not configured. Add STRIPE_SECRET_KEY to .env.local." },
      { status: 503 },
    );
  }

  const googleId = googleSession.user.id || googleSession.user.email || "";
  let entitlement = readEntitlement(request);
  if (googleId) entitlement = withAccountId(entitlement, googleId);
  const origin = request.nextUrl.origin;
  const priceId = process.env.STRIPE_PRICE_ID;

  const checkoutSession = await stripe.checkout.sessions.create({
    mode: "payment",
    success_url: `${origin}/?checkout=success&session_id={CHECKOUT_SESSION_ID}`,
    cancel_url: `${origin}/#upload`,
    client_reference_id: entitlement.userId,
    metadata: { userId: entitlement.userId },
    line_items: priceId
      ? [{ price: priceId, quantity: 1 }]
      : [
          {
            quantity: 1,
            price_data: {
              currency: "twd",
              unit_amount: PLAN_PRICE_TWD,
              product_data: {
                name: "Course Copilot NT$33 Plan",
                description: "30 high-precision gpt-4o extractions + unlimited .ics downloads",
              },
            },
          },
        ],
  });

  if (!checkoutSession.url) {
    return NextResponse.json({ error: "Could not start Stripe Checkout." }, { status: 502 });
  }

  const response = usageResponse(
    entitlement,
    { url: checkoutSession.url, sessionId: checkoutSession.id },
    true,
  );
  return response;
}
