import {
  createCheckoutRecovery,
  type CheckoutState,
  type PaymentProvider,
} from "./checkout-recovery";

export function createBrowserCheckout(
  accountId: string,
  changed: (state: CheckoutState) => void,
) {
  return createCheckoutRecovery(accountId, {
    // Resolve storage inside the operation: accessing localStorage itself may throw.
    storage: {
      get length() {
        return window.localStorage.length;
      },
      key: (i) => window.localStorage.key(i),
      getItem: (key) => window.localStorage.getItem(key),
      setItem: (key, value) => window.localStorage.setItem(key, value),
      removeItem: (key) => window.localStorage.removeItem(key),
    },
    now: Date.now,
    sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
    changed,
    async resolveAttempt(attemptId, signal) {
      const response = await fetch(
        `/api/checkout/return-reference?attempt=${encodeURIComponent(attemptId)}`,
        { signal, cache: "no-store" },
      );
      if (response.status === 401) return { status: "sign-in" };
      if (response.status === 403) return { status: "wrong-account" };
      if (!response.ok) throw new Error("Return lookup unavailable");
      const data = await response.json();
      if (data.provider !== "stripe" || typeof data.paymentId !== "string")
        throw new Error("Invalid reference");
      return { provider: "stripe", paymentId: data.paymentId };
    },
    async create(provider: PaymentProvider, locale, attemptId, signal) {
      const response = await fetch(
        provider === "ecpay" ? "/api/checkout/ecpay" : "/api/checkout",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ locale, attemptId }),
          signal,
        },
      );
      if (!response.ok) throw new Error("Checkout unavailable");
      if (provider === "ecpay") {
        const paymentId = response.headers.get("x-cc-payment-id");
        if (
          !paymentId ||
          !response.headers.get("content-type")?.includes("text/html")
        )
          throw new Error("Invalid checkout");
        return { provider, paymentId, destination: await response.text() };
      }
      const data = await response.json();
      if (typeof data.url !== "string" || typeof data.sessionId !== "string")
        throw new Error("Invalid checkout");
      return { provider, paymentId: data.sessionId, destination: data.url };
    },
    async confirm(reference, signal) {
      const endpoint =
        reference.provider === "ecpay"
          ? `/api/checkout/ecpay/status?order=${encodeURIComponent(reference.paymentId)}`
          : `/api/checkout/confirm?session_id=${encodeURIComponent(reference.paymentId)}`;
      const response = await fetch(endpoint, { signal, cache: "no-store" });
      if (response.status === 401) return { status: "sign-in" };
      if (
        response.status === 403 ||
        (reference.provider === "ecpay" && response.status === 404)
      )
        return { status: "wrong-account" };
      if (reference.provider === "stripe" && response.status === 402)
        return { status: "pending" };
      if (!response.ok) throw new Error("Confirmation unavailable");
      const data = await response.json();
      return {
        status: (
          reference.provider === "ecpay"
            ? data.paymentStatus === "paid"
            : data.paid === true
        )
          ? "paid"
          : "pending",
        usage: data,
      };
    },
    depart(result) {
      if (result.provider === "stripe")
        window.location.assign(result.destination);
      else {
        document.open();
        document.write(result.destination);
        document.close();
      }
    },
  });
}
