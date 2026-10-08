import { NextRequest, NextResponse } from "next/server";
import Stripe from "stripe";
import {
  ECPAY_TWD_NOTE,
  getRateSnapshot,
  quoteFromRates,
  twdQuote,
  type PlanQuote,
} from "@/lib/currency";
import { readEntitlement, usageResponse, withAccountId } from "@/lib/entitlement";
import { getGoogleSession } from "@/lib/session";

function isEcpayCheckout() {
  const provider = (process.env.PAYMENT_PROVIDER || "").toLowerCase();
  return provider === "ecpay" || Boolean(process.env.ECPAY_MERCHANT_ID);
}

async function quoteForRequest(locale: string): Promise<PlanQuote> {
  if (isEcpayCheckout()) return twdQuote(ECPAY_TWD_NOTE);
  try {
    const snapshot = await getRateSnapshot();
    return quoteFromRates(locale, snapshot.rates);
  } catch {
    return twdQuote();
  }
}

function stripeClient() {
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) return null;
  return new Stripe(key);
}

export async function POST(request: NextRequest) {
  const googleSession = await getGoogleSession();
  if (!googleSession?.user) {
    return NextResponse.json(
      { error: "Sign in with Google to unlock the NT$9 plan.", requiresAuth: true },
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

  let locale = "zh-TW";
  try {
    const body = (await request.json()) as { locale?: unknown };
    if (typeof body?.locale === "string" && body.locale.length <= 35) locale = body.locale;
  } catch {
    locale = "zh-TW";
  }
  const quote = await quoteForRequest(locale);
  const description = quote.note
    ? `${quote.note}. 30 high-precision gpt-4o extractions + unlimited .ics downloads`
    : "30 high-precision gpt-4o extractions + unlimited .ics downloads";

  const checkoutSession = await stripe.checkout.sessions.create({
    mode: "payment",
    success_url: `${origin}/?checkout=success&session_id={CHECKOUT_SESSION_ID}`,
    cancel_url: `${origin}/#upload`,
    client_reference_id: entitlement.userId,
    metadata: {
      userId: entitlement.userId,
      currency: quote.currency,
      amount: String(quote.amount),
    },
    line_items: [
      {
        quantity: 1,
        price_data: {
          currency: quote.currency.toLowerCase(),
          unit_amount: quote.unitAmount,
          product_data: {
            name: `Course Copilot ${quote.label}`,
            description,
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
