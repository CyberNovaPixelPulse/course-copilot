/* eslint-disable @typescript-eslint/no-require-imports */
const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const Module = require("node:module");
const ts = require("typescript");
const resolve = Module._resolveFilename;
Module._resolveFilename = function (id, ...args) {
  return resolve.call(
    this,
    id.startsWith("@/") ? path.join(__dirname, "..", id.slice(2)) : id,
    ...args,
  );
};
Module._extensions[".ts"] = (m, f) =>
  m._compile(
    ts.transpileModule(fs.readFileSync(f, "utf8"), {
      compilerOptions: {
        module: ts.ModuleKind.CommonJS,
        target: ts.ScriptTarget.ES2022,
        esModuleInterop: true,
      },
    }).outputText,
    f,
  );
const { createClient } = require("@libsql/client");
const { createAccountEntitlements } = require("../lib/account-entitlements.ts");
test("account owns one free grant across sessions; account isolation", async () => {
  const db = createClient({ url: ":memory:" });
  try {
    const store = createAccountEntitlements(db);
    assert.equal((await store.usage("a")).freeRemaining, 3);
    assert.equal((await store.usage("a")).freeRemaining, 3);
    assert.equal((await store.usage("b")).remaining, 3);
    assert.equal((await store.usage("a")).canExport, false);
  } finally {
    db.close();
  }
});
const courses = [
  {
    name: "Math",
    professor: "",
    slots: [
      { weekday: "Monday", startTime: "08:00", endTime: "09:00", location: "" },
    ],
  },
];
test("only one last-credit job starts; successful result and same-job retry never double charge", async () => {
  const db = createClient({ url: ":memory:" });
  let now = 1000000;
  const s = createAccountEntitlements(db, () => now);
  try {
    for (let i = 0; i < 2; i++) {
      await s.begin("a", "consume-credit-" + i, "image");
      await s.complete("a", "consume-credit-" + i, courses);
    }
    const out = await Promise.allSettled([
      s.begin("a", "last-credit-job-1", "x"),
      s.begin("a", "last-credit-job-2", "y"),
    ]);
    assert.equal(out.filter((x) => x.status === "fulfilled").length, 1);
    assert.equal(
      out.filter((x) => x.status === "rejected")[0].reason.code,
      "insufficient_credits",
    );
    await s.complete("a", "last-credit-job-1", courses);
    const repeated = await s.begin("a", "last-credit-job-1", "x");
    assert.equal(repeated.started, false);
    assert.deepEqual(repeated.courses, courses);
    assert.equal((await s.usage("a")).remaining, 0);
    assert.deepEqual(await s.jobs("b", "last-credit-job-1"), []);
    now += 7 * 86400000;
    assert.equal((await s.jobs("a", "last-credit-job-1"))[0].courses, null);
    await assert.rejects(s.begin("a", "last-credit-job-1", "different"), {
      code: "job_conflict",
    });
  } finally {
    db.close();
  }
});
test("failure and expiry release once; late completion cannot charge; purchases retain free credits", async () => {
  const db = createClient({ url: ":memory:" });
  let now = 100;
  const s = createAccountEntitlements(db, () => now);
  try {
    await s.begin("a", "failed-job-0000001", "x");
    await s.fail("a", "failed-job-0000001");
    await s.fail("a", "failed-job-0000001");
    assert.equal((await s.usage("a")).remaining, 3);
    await s.begin("a", "expired-job-000001", "x");
    now += 180000;
    await s.cleanup();
    await assert.rejects(s.complete("a", "expired-job-000001", courses), {
      code: "job_expired",
    });
    assert.equal((await s.usage("a")).remaining, 3);
    await s.begin("a", "successful-job-01", "x");
    await s.complete("a", "successful-job-01", courses);
    await s.grant("a", "purchase-1", 30);
    await s.grant("a", "purchase-1", 30);
    assert.deepEqual(await s.usage("a"), {
      freeRemaining: 2,
      creditRemaining: 30,
      remaining: 32,
      canExport: true,
    });
    await s.begin("a", "free-first-job-01", "x");
    await s.complete("a", "free-first-job-01", courses);
    assert.equal((await s.usage("a")).creditRemaining, 30);
    await assert.rejects(s.grant("b", "purchase-1", 30), {
      code: "grant_conflict",
    });
  } finally {
    db.close();
  }
});
test("coupon last use is atomic and retries return the original grant", async () => {
  const db = createClient({ url: ":memory:" });
  const s = createAccountEntitlements(db);
  try {
    await db.execute(
      "CREATE TABLE coupons(id TEXT,code TEXT,site_id TEXT,is_active INTEGER,expires_at TEXT,discount_type TEXT,discount_value INTEGER,max_uses INTEGER,used_count INTEGER)",
    );
    await db.execute(
      "INSERT INTO coupons VALUES ('one','ONE','course-copilot',1,NULL,'credits',10,1,0)",
    );
    const r = await Promise.allSettled([
      s.redeem("a", "ONE"),
      s.redeem("b", "ONE"),
    ]);
    assert.equal(r.filter((x) => x.status === "fulfilled").length, 1);
    assert.equal((await s.redeem("a", "ONE")).remaining, 13);
    assert.equal((await s.usage("b")).remaining, 3);
  } finally {
    db.close();
  }
});
test("Stripe must match a saved checkout and grant once; reviews are idempotent", async () => {
  const db = createClient({ url: ":memory:" });
  const s = createAccountEntitlements(db);
  try {
    const session = {
      id: "cs_1",
      payment_status: "paid",
      client_reference_id: "a",
      metadata: { userId: "a" },
      amount_total: 900,
      currency: "twd",
    };
    await assert.rejects(s.confirmStripe(session), {
      code: "payment_review_required",
    });
    await s.saveCheckout("a", "cs_1", 900, "twd");
    await assert.rejects(s.confirmStripe({ ...session, amount_total: 100 }), {
      code: "payment_mismatch",
    });
    await s.confirmStripe(session);
    await s.confirmStripe(session);
    assert.equal((await s.usage("a")).remaining, 33);
    const reviews = await s.requestReview("a", "old receipt");
    await s.requestReview("a", "old receipt");
    assert.equal((await s.reviews("a")).length, 1);
    await s.resolveReview(
      reviews[0].id,
      5,
      true,
      "verified receipt",
      "receipt-1",
    );
    await s.resolveReview(reviews[0].id, 5, true, "retry", "receipt-1");
    assert.equal((await s.usage("a")).remaining, 38);
  } finally {
    db.close();
  }
});
test("separate review requests for the same verified source cannot grant twice", async () => {
  const db = createClient({ url: ":memory:" });
  const s = createAccountEntitlements(db);
  try {
    const one = (await s.requestReview("a", "first request"))[0];
    const two = (await s.requestReview("a", "second request")).find(
      (r) => r.id !== one.id,
    );
    await s.resolveReview(one.id, 30, true, "verified by admin", "receipt-123");
    await s.resolveReview(
      two.id,
      30,
      true,
      "verified same receipt",
      "receipt-123",
    );
    assert.equal((await s.usage("a")).creditRemaining, 30);
  } finally {
    db.close();
  }
});
test("independent database connections cannot reserve the same last credit", async () => {
  const os = require("node:os");
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "cc-concurrency-"));
  const url = "file:" + path.join(dir, "ledger.db");
  const first = createClient({ url }),
    second = createClient({ url });
  const a = createAccountEntitlements(first),
    b = createAccountEntitlements(second);
  try {
    await a.usage("a");
    await b.usage("a");
    for (let i = 0; i < 2; i++) {
      await a.begin("a", "warmup-credit-00" + i, "x");
      await a.complete("a", "warmup-credit-00" + i, courses);
    }
    const results = await Promise.allSettled([
      a.begin("a", "cross-process-001", "x"),
      b.begin("a", "cross-process-002", "x"),
    ]);
    assert.equal(results.filter((r) => r.status === "fulfilled").length, 1);
    assert.equal((await a.usage("a")).remaining, 0);
  } finally {
    first.close();
    second.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
test("coupon grant failure rolls back its final global use", async () => {
  const db = createClient({ url: ":memory:" });
  const s = createAccountEntitlements(db);
  try {
    await db.execute(
      "CREATE TABLE coupons(id TEXT,code TEXT,site_id TEXT,is_active INTEGER,expires_at TEXT,discount_type TEXT,discount_value INTEGER,max_uses INTEGER,used_count INTEGER)",
    );
    await db.execute(
      "INSERT INTO coupons VALUES ('one','ONE','course-copilot',1,NULL,'credits',10,1,0)",
    );
    await s.grant("other", "coupon:a:ONE", 10);
    await assert.rejects(s.redeem("a", "ONE"), { code: "grant_conflict" });
    assert.equal((await s.redeem("b", "ONE")).creditRemaining, 10);
  } finally {
    db.close();
  }
});
test("durable ECPay import subtracts old usage once and credits new purchases once", async () => {
  const db = createClient({ url: ":memory:" });
  const s = createAccountEntitlements(db);
  try {
    await db.execute(
      "CREATE TABLE cc_ecpay_orders(trade_no TEXT,account_id TEXT,paid_at INTEGER,created_at INTEGER)",
    );
    await db.execute(
      "CREATE TABLE cc_ecpay_usage(account_id TEXT,used_count INTEGER)",
    );
    await db.execute(
      "INSERT INTO cc_ecpay_orders VALUES ('paid1','a',1,1),('pending','a',NULL,2)",
    );
    await db.execute("INSERT INTO cc_ecpay_usage VALUES ('a',22)");
    await s.importEcpay("a");
    assert.equal((await s.usage("a")).creditRemaining, 8);
    await s.begin("a", "consume-free-001", "image");
    await s.complete("a", "consume-free-001", courses);
    await s.importEcpay("a");
    assert.equal((await s.usage("a")).freeRemaining, 2);
    await db.execute("INSERT INTO cc_ecpay_orders VALUES ('paid2','a',3,3)");
    await s.importEcpay("a");
    await s.importEcpay("a");
    assert.equal((await s.usage("a")).creditRemaining, 38);
  } finally {
    db.close();
  }
});
test("verified legacy free initialization is repeatable and never overwrites a live account", async () => {
  const db = createClient({ url: ":memory:" });
  const s = createAccountEntitlements(db);
  try {
    await s.initializeLegacyFree("a", 1, "audit-1");
    await s.initializeLegacyFree("a", 1, "audit-1");
    assert.equal((await s.usage("a")).freeRemaining, 1);
    await assert.rejects(s.initializeLegacyFree("a", 3, "different"), {
      code: "migration_already_started",
    });
  } finally {
    db.close();
  }
});
