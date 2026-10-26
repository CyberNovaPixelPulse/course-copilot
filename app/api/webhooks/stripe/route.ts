import Stripe from "stripe";
import { accountStore } from "@/lib/account-access";
import { AccountError } from "@/lib/account-entitlements";
export async function POST(request: Request) {
  const key = process.env.STRIPE_SECRET_KEY,
    secret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!key || !secret)
    return new Response("Webhook not configured", { status: 503 });
  const stripe = new Stripe(key);
  let event: Stripe.Event;
  try {
    event = stripe.webhooks.constructEvent(
      await request.text(),
      request.headers.get("stripe-signature") || "",
      secret,
    );
  } catch {
    return new Response("Invalid signature", { status: 400 });
  }
  if (
    event.type !== "checkout.session.completed" &&
    event.type !== "checkout.session.async_payment_succeeded"
  )
    return new Response("OK");
  try {
    const session = await stripe.checkout.sessions.retrieve(
      (event.data.object as Stripe.Checkout.Session).id,
    );
    if (session.payment_status !== "paid") return new Response("OK");
    await accountStore().confirmStripe(session);
    return new Response("OK");
  } catch (e) {
    // Unknown checkouts can be a creation/notification race. Retry instead of losing a paid event.
    return new Response(
      e instanceof AccountError ? e.code : "Temporarily unavailable",
      { status: 503 },
    );
  }
}
