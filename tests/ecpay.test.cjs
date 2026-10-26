/* eslint-disable @typescript-eslint/no-require-imports -- Node CommonJS test harness transpiles project TypeScript. */
const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const Module = require("node:module");
const ts = require("typescript");
const { createClient } = require("@libsql/client");
const root = path.resolve(__dirname, "..");
const originalResolve = Module._resolveFilename;
Module._resolveFilename = function (specifier, ...args) {
  return originalResolve.call(
    this,
    specifier.startsWith("@/")
      ? path.join(root, specifier.slice(2))
      : specifier,
    ...args,
  );
};
Module._extensions[".ts"] = (module, filename) => {
  const source = fs.readFileSync(filename, "utf8");
  module._compile(
    ts.transpileModule(source, {
      compilerOptions: {
        module: ts.ModuleKind.CommonJS,
        target: ts.ScriptTarget.ES2022,
        esModuleInterop: true,
      },
    }).outputText,
    filename,
  );
};
const db = createClient({ url: ":memory:" });
const turso = require("../lib/turso.ts");
turso.getTurso = () => db;
process.env.ECPAY_MERCHANT_ID = "test-merchant";
process.env.ECPAY_HASH_KEY = "test-key";
process.env.ECPAY_HASH_IV = "test-iv";
const ecpay = require("../lib/ecpay.ts");
const orders = require("../lib/ecpay-orders.ts");
const ent = require("../lib/entitlement.ts");
const webhook = require("../app/api/webhooks/ecpay/route.ts");
const returned = require("../app/api/checkout/ecpay/return/route.ts");
function notification(tradeNo, extra = {}) {
  const params = {
    MerchantID: "test-merchant",
    MerchantTradeNo: tradeNo,
    TradeNo: "gateway-" + tradeNo,
    TradeAmt: "9",
    RtnCode: "1",
    SimulatePaid: "0",
    ...extra,
  };
  params.CheckMacValue = ecpay.checkMacValue(params, "test-key", "test-iv");
  return params;
}
function unpaid(id) {
  return { ...ent.emptyEntitlement(), userId: id };
}
before(async () => {
  await orders.ensurePaymentTables();
});
after(() => db.close());
test("unique alphanumeric trade numbers fit ECPay limit", () => {
  const ids = Array.from({ length: 1000 }, () => ecpay.merchantTradeNo());
  assert.equal(new Set(ids).size, ids.length);
  assert(ids.every((id) => /^[A-Za-z0-9]{20}$/.test(id)));
  assert.equal(
    ecpay.merchantTradeDate(new Date("2026-10-15T16:01:02Z")),
    "2026/10/16 00:01:02",
  );
});
test("official CheckMacValue fixture", () => {
  const params = {
    TradeDesc: "促銷方案",
    PaymentType: "aio",
    MerchantTradeDate: "2023/03/12 15:30:23",
    MerchantTradeNo: "ecpay20230312153023",
    MerchantID: "3002607",
    ReturnURL: "https://www.ecpay.com.tw/receive.php",
    ItemName: "Apple iphone 15",
    TotalAmount: "30000",
    ChoosePayment: "ALL",
    EncryptType: "1",
  };
  assert.equal(
    ecpay.checkMacValue(params, "pwFHCqoQZGmho4w6", "EkRm7iFT261dpevs"),
    "6C51C9E6888DE861FD62FB1DD17029FC742634498FD813DC43D4243B5685B840",
  );
});
test("reject unknown order, tampered signature, amount and merchant", async () => {
  await orders.createPaymentOrder(
    "invalidcases",
    unpaid("invalid-user"),
    "test-merchant",
    ecpay.ECPAY_PRODUCTION_URL,
  );
  assert.equal(
    await orders.acceptPaymentNotification(notification("missing")),
    false,
  );
  assert.equal(
    await orders.acceptPaymentNotification({
      ...notification("invalidcases"),
      TradeAmt: "1",
    }),
    false,
  );
  assert.equal(
    await orders.acceptPaymentNotification(
      notification("invalidcases", { TradeAmt: "10" }),
    ),
    false,
  );
  assert.equal(
    await orders.acceptPaymentNotification(
      notification("invalidcases", { MerchantID: "other" }),
    ),
    false,
  );
  assert.equal(
    await orders.acceptPaymentNotification({
      ...notification("invalidcases"),
      CheckMacValue: "wrong",
    }),
    false,
  );
});
test("failed and simulated payments do not unlock", async () => {
  await orders.createPaymentOrder(
    "simulation",
    unpaid("sim-user"),
    "test-merchant",
    ecpay.ECPAY_PRODUCTION_URL,
  );
  assert.equal(
    await orders.acceptPaymentNotification(
      notification("simulation", { SimulatePaid: "1" }),
    ),
    true,
  );
  assert.equal(
    await orders.acceptPaymentNotification(
      notification("simulation", { RtnCode: "0" }),
    ),
    true,
  );
  assert.equal(
    (await orders.reconcileEcpayEntitlement(unpaid("sim-user"))).paid,
    false,
  );
});
test("real payment grants 30 once; retries, repeated purchase, restore and consumption", async () => {
  await orders.createPaymentOrder(
    "purchase1",
    unpaid("buyer"),
    "test-merchant",
    ecpay.ECPAY_PRODUCTION_URL,
  );
  const callback = notification("purchase1");
  assert.equal(await orders.acceptPaymentNotification(callback), true);
  assert.equal(await orders.acceptPaymentNotification(callback), true);
  let state = await orders.reconcileEcpayEntitlement(unpaid("buyer"));
  assert.equal(ent.toUsagePublic(state, true).gpt4oRemaining, 30);
  state = await orders.reconcileEcpayEntitlement(state);
  assert.equal(ent.toUsagePublic(state, true).gpt4oRemaining, 30);
  state = await orders.recordEcpayUsage(ent.incrementParse(state, "gpt-4o"));
  assert.equal(ent.toUsagePublic(state, true).gpt4oRemaining, 29);
  const restored = await orders.reconcileEcpayEntitlement(unpaid("buyer"));
  assert.equal(ent.toUsagePublic(restored, true).gpt4oRemaining, 29);
  await orders.createPaymentOrder(
    "purchase2",
    state,
    "test-merchant",
    ecpay.ECPAY_PRODUCTION_URL,
  );
  await orders.acceptPaymentNotification(notification("purchase2"));
  state = await orders.reconcileEcpayEntitlement(state);
  assert.equal(ent.toUsagePublic(state, true).gpt4oRemaining, 59);
  assert.equal(
    ent.toUsagePublic(
      await orders.reconcileEcpayEntitlement(unpaid("buyer")),
      true,
    ).gpt4oRemaining,
    59,
  );
  assert.equal(ent.withAccountId(state, "someone-else").paid, false);
});
test("existing coupon allowance is preserved when purchasing", async () => {
  const coupon = ent.grantCreditCoupon(unpaid("coupon-buyer"), "PROMO", 10);
  await orders.createPaymentOrder(
    "couponpurchase",
    coupon,
    "test-merchant",
    ecpay.ECPAY_PRODUCTION_URL,
  );
  await orders.acceptPaymentNotification(notification("couponpurchase"));
  const state = await orders.reconcileEcpayEntitlement(coupon);
  assert.equal(ent.toUsagePublic(state, true).gpt4oRemaining, 40);
});
test("webhook returns exact acknowledgement and browser redirect grants nothing", async () => {
  await orders.createPaymentOrder(
    "webhooktest",
    unpaid("webhook-user"),
    "test-merchant",
    ecpay.ECPAY_PRODUCTION_URL,
  );
  const response = await webhook.POST(
    new Request("https://example.com/api/webhooks/ecpay", {
      method: "POST",
      body: new URLSearchParams(notification("webhooktest")),
    }),
  );
  assert.equal(response.status, 200);
  assert.equal(await response.text(), "1|OK");
  const bad = await webhook.POST(
    new Request("https://example.com/api/webhooks/ecpay", {
      method: "POST",
      body: new URLSearchParams({ MerchantTradeNo: "missing" }),
    }),
  );
  assert.equal(bad.status, 400);
  const redirect = await returned.POST(
    new Request("https://example.com/api/checkout/ecpay/return", {
      method: "POST",
      body: new URLSearchParams({ MerchantTradeNo: "unpaid", RtnCode: "1" }),
    }),
  );
  assert.equal(redirect.status, 303);
  assert.equal(
    new URL(redirect.headers.get("location")).searchParams.get("ecpay_order"),
    "unpaid",
  );
});

const { NextRequest } = require("next/server");
const sessionModule = require("../lib/session.ts");
let googleSession = null;
sessionModule.getGoogleSession = async () => googleSession;
const checkout = require("../app/api/checkout/ecpay/route.ts");
const paymentStatus = require("../app/api/checkout/ecpay/status/route.ts");
let stripeSession = {};
let createdStripeOptions;
const realWebhooks = new (require("stripe"))("sk_test_fixture").webhooks;
const originalLoad = Module._load;
Module._load = function (id, ...args) {
  if (id === "stripe")
    return class Stripe {
      webhooks = realWebhooks;
      checkout = {
        sessions: {
          retrieve: async () => stripeSession,
          create: async (options) => {
            createdStripeOptions = options;
            return {
              id: "cs_return_fixture",
              url: "https://checkout.example.invalid/fixture",
            };
          },
        },
      };
    };
  return originalLoad.call(this, id, ...args);
};
const stripeCheckout = require("../app/api/checkout/route.ts");
const returnReference = require("../app/api/checkout/return-reference/route.ts");
const stripeConfirm = require("../app/api/checkout/confirm/route.ts");
const stripeWebhook = require("../app/api/webhooks/stripe/route.ts");
Module._load = originalLoad;

test("checkout and status enforce sign-in and order ownership; payment unlocks via status", async () => {
  process.env.ECPAY_ENV = "production";
  googleSession = null;
  assert.equal(
    (
      await checkout.POST(
        new NextRequest("https://shop.example/api/checkout/ecpay", {
          method: "POST",
        }),
      )
    ).status,
    401,
  );
  assert.equal(
    (
      await paymentStatus.GET(
        new NextRequest(
          "https://shop.example/api/checkout/ecpay/status?order=missing",
        ),
      )
    ).status,
    401,
  );
  googleSession = { user: { id: "checkout-buyer" } };
  const response = await checkout.POST(
    new NextRequest("https://shop.example/api/checkout/ecpay", {
      method: "POST",
    }),
  );
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("cache-control"), "no-store");
  const html = await response.text();
  const id = html.match(/name="MerchantTradeNo" value="([^"]+)"/)[1];
  assert.equal(response.headers.get("x-cc-payment-id"), id);
  assert(html.includes('name="TotalAmount" value="9"'));
  assert(html.includes("/api/webhooks/ecpay"));
  assert(html.includes("/api/checkout/ecpay/return"));
  const url = "https://shop.example/api/checkout/ecpay/status?order=" + id;
  googleSession = { user: { id: "different-buyer" } };
  assert.equal((await paymentStatus.GET(new NextRequest(url))).status, 404);
  googleSession = { user: { id: "checkout-buyer" } };
  const pending = await (await paymentStatus.GET(new NextRequest(url))).json();
  assert.equal(pending.paymentStatus, "pending");
  assert.equal(pending.paid, false);
  await orders.acceptPaymentNotification(notification(id));
  const confirmed = await paymentStatus.GET(new NextRequest(url));
  assert.equal(confirmed.headers.get("cache-control"), "no-store");
  const paid = await confirmed.json();
  assert.equal(paid.paymentStatus, "paid");
  assert.equal(paid.gpt4oRemaining, 30);
  assert.equal(paid.canExportIcs, true);
});

test("concurrent identical callbacks grant once and conflicting transaction is rejected", async () => {
  await orders.createPaymentOrder(
    "concurrent",
    unpaid("concurrent-buyer"),
    "test-merchant",
    ecpay.ECPAY_PRODUCTION_URL,
  );
  const signed = notification("concurrent");
  assert.deepEqual(
    await Promise.all([
      orders.acceptPaymentNotification(signed),
      orders.acceptPaymentNotification(signed),
    ]),
    [true, true],
  );
  assert.equal(
    await orders.acceptPaymentNotification(
      notification("concurrent", { TradeNo: "different-transaction" }),
    ),
    false,
  );
  assert.equal(
    ent.toUsagePublic(
      await orders.reconcileEcpayEntitlement(unpaid("concurrent-buyer")),
      true,
    ).gpt4oRemaining,
    30,
  );
});

test("old signed entitlement cannot restore already consumed payment credits", async () => {
  await orders.createPaymentOrder(
    "replay",
    unpaid("replay-buyer"),
    "test-merchant",
    ecpay.ECPAY_PRODUCTION_URL,
  );
  await orders.acceptPaymentNotification(notification("replay"));
  const old = await orders.reconcileEcpayEntitlement(unpaid("replay-buyer"));
  await orders.recordEcpayUsage(ent.incrementParse(old, "gpt-4o"));
  assert.equal(
    ent.toUsagePublic(await orders.reconcileEcpayEntitlement(old), true)
      .gpt4oRemaining,
    29,
  );
});

test("duplicate webhook fields and unsigned notifications are rejected", async () => {
  const form = new URLSearchParams(notification("webhooktest"));
  form.append("TradeAmt", "9");
  const response = await webhook.POST(
    new Request("https://shop.example/api/webhooks/ecpay", {
      method: "POST",
      body: form,
    }),
  );
  assert.equal(response.status, 400);
});

test("Stripe completed but unpaid session cannot unlock; payment must belong to account", async () => {
  process.env.STRIPE_SECRET_KEY = "sk_test_placeholder";
  const request = () =>
    new NextRequest(
      "https://shop.example/api/checkout/confirm?session_id=cs_test_placeholder",
    );
  googleSession = null;
  assert.equal((await stripeConfirm.GET(request())).status, 401);
  googleSession = { user: { id: "stripe-buyer" } };
  await require("../lib/account-access.ts")
    .accountStore()
    .saveCheckout("stripe-buyer", "cs_test_placeholder", 900, "twd");
  stripeSession = {
    id: "cs_test_placeholder",
    amount_total: 900,
    currency: "twd",
    status: "complete",
    payment_status: "unpaid",
    client_reference_id: "stripe-buyer",
    metadata: { userId: "stripe-buyer" },
  };
  assert.equal((await stripeConfirm.GET(request())).status, 402);
  stripeSession.payment_status = "paid";
  stripeSession.client_reference_id = "another-buyer";
  assert.equal((await stripeConfirm.GET(request())).status, 403);
  stripeSession.client_reference_id = "stripe-buyer";
  const response = await stripeConfirm.GET(request());
  assert.equal(response.status, 200);
  assert.equal((await response.json()).paid, true);
});

test("Stripe signed notification grants without browser return, rejects tampering and deduplicates", async () => {
  process.env.STRIPE_SECRET_KEY = "sk_test_fixture";
  process.env.STRIPE_WEBHOOK_SECRET = "whsec_fixture";
  const store = require("../lib/account-access.ts").accountStore();
  await store.saveCheckout("webhook-buyer", "cs_webhook", 900, "twd");
  stripeSession = {
    id: "cs_webhook",
    payment_status: "paid",
    client_reference_id: "webhook-buyer",
    metadata: { userId: "webhook-buyer" },
    amount_total: 900,
    currency: "twd",
  };
  const payload = JSON.stringify({
    id: "evt_fixture",
    type: "checkout.session.completed",
    data: { object: { id: "cs_webhook" } },
  });
  const signed = realWebhooks.generateTestHeaderString({
    payload,
    secret: "whsec_fixture",
  });
  const request = (signature = signed) =>
    new Request("https://shop.example/api/webhooks/stripe", {
      method: "POST",
      headers: { "stripe-signature": signature },
      body: payload,
    });
  assert.equal((await stripeWebhook.POST(request("invalid"))).status, 400);
  assert.equal((await stripeWebhook.POST(request())).status, 200);
  assert.equal((await stripeWebhook.POST(request())).status, 200);
  assert.equal((await store.usage("webhook-buyer")).creditRemaining, 30);
});

test("Stripe cancellation return is resolvable without browser storage and remains account scoped", async () => {
  process.env.STRIPE_SECRET_KEY = "sk_test_fixture";
  googleSession = { user: { id: "return-buyer" } };
  const response = await stripeCheckout.POST(
    new NextRequest("https://shop.example/api/checkout", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        locale: "zh-TW",
        attemptId: "return-attempt-fixture",
      }),
    }),
  );
  assert.equal(response.status, 200);
  assert(
    createdStripeOptions.cancel_url.includes(
      "checkout=cancel&cc_attempt=return-attempt-fixture",
    ),
  );
  assert(
    createdStripeOptions.success_url.includes(
      "session_id={CHECKOUT_SESSION_ID}&cc_attempt=return-attempt-fixture",
    ),
  );
  const request = new NextRequest(
    "https://shop.example/api/checkout/return-reference?attempt=return-attempt-fixture",
  );
  const own = await returnReference.GET(request);
  assert.equal(own.status, 200);
  assert.deepEqual(await own.json(), {
    provider: "stripe",
    paymentId: "cs_return_fixture",
  });
  googleSession = { user: { id: "other-buyer" } };
  assert.equal((await returnReference.GET(request)).status, 403);
  googleSession = null;
  assert.equal((await returnReference.GET(request)).status, 401);
});
