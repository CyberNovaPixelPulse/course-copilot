/* eslint-disable @typescript-eslint/no-require-imports */
const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const ts = require("typescript");
require.extensions[".ts"] = (m, f) =>
  m._compile(
    ts.transpileModule(fs.readFileSync(f, "utf8"), {
      compilerOptions: {
        module: ts.ModuleKind.CommonJS,
        target: ts.ScriptTarget.ES2022,
      },
    }).outputText,
    f,
  );
const { createCheckoutRecovery } = require("../lib/checkout-recovery.ts");
function setup(overrides = {}) {
  let time = 1000;
  const values = new Map();
  const storage = {
    get length() {
      return values.size;
    },
    key: (i) => [...values.keys()][i] ?? null,
    getItem: (k) => values.get(k) ?? null,
    setItem: (k, v) => values.set(k, v),
    removeItem: (k) => values.delete(k),
  };
  const states = [],
    departures = [];
  const deps = {
    resolveAttempt: async () => ({ status: "wrong-account" }),
    storage,
    now: () => time,
    sleep: async (ms) => {
      time += ms;
    },
    create: async (provider) => ({
      provider,
      paymentId: provider === "ecpay" ? "CC001" : "cs_001",
      destination: "fixture",
    }),
    confirm: async () => ({ status: "paid", usage: { userId: "alice" } }),
    depart: (x) => departures.push(x),
    changed: (x) => states.push(x),
    ...overrides,
  };
  return {
    deps,
    storage,
    values,
    states,
    departures,
    advance: (ms) => {
      time += ms;
    },
    flow: createCheckoutRecovery("alice", deps),
  };
}
test("both providers confirm through one interface without restoring a schedule", async () => {
  for (const query of [
    "?ecpay_order=CC001",
    "?checkout=success&session_id=cs_001",
  ]) {
    const { flow } = setup();
    await flow.handleReturn(query);
    assert.equal(flow.state().payment, "paid");
    assert.equal(flow.state().usage.userId, "alice");
    assert.deepEqual(flow.listDrafts(), []);
  }
});
const courses = [
  {
    name: "Edited mathematics",
    professor: "Teacher",
    slots: [
      {
        weekday: "Monday",
        startTime: "08:10",
        endTime: "10:00",
        location: "Changed room",
      },
    ],
  },
];
test("each checkout saves edited courses before departure and explicit restore requires overwrite consent", async () => {
  for (const provider of ["ecpay", "stripe"]) {
    const { flow, departures } = setup();
    await flow.start(provider, courses, "zh-TW");
    assert.equal(departures.length, 1);
    const [draft] = flow.listDrafts();
    assert.equal(draft.provider, provider);
    assert.equal(draft.paymentId, provider === "ecpay" ? "CC001" : "cs_001");
    assert.equal(flow.restore(draft.id, true).status, "needs-confirmation");
    assert.deepEqual(flow.restore(draft.id, true, true).courses, courses);
    assert.equal(flow.listDrafts().length, 1);
  }
});
test("reopened browser lists distinct attempts until exactly seven days, with explicit discard", async () => {
  const x = setup();
  await x.flow.start("ecpay", courses, "zh-TW");
  x.advance(50);
  await x.flow.start("stripe", [{ ...courses[0], name: "Second" }], "zh-TW");
  const reopened = createCheckoutRecovery("alice", x.deps);
  assert.equal(reopened.listDrafts().length, 2);
  assert.equal(createCheckoutRecovery("bob", x.deps).listDrafts().length, 0);
  const first = reopened.listDrafts().find((d) => d.provider === "ecpay");
  await reopened.handleReturn("?ecpay_order=CC001");
  assert.equal(reopened.state().preferredDraftId, first.id);
  x.advance(7 * 86400000 - 50);
  assert.equal(reopened.listDrafts().length, 1);
  reopened.discard(reopened.listDrafts()[0].id);
  assert.equal(reopened.listDrafts().length, 0);
});
test("storage failure blocks checkout until explicitly bypassed; creation failure leaves a recoverable draft", async () => {
  const x = setup();
  x.storage.setItem = () => {
    throw new Error("quota");
  };
  await x.flow.start("stripe", courses, "en");
  assert.equal(x.flow.state().problem, "save");
  assert.equal(x.departures.length, 0);
  await x.flow.start("stripe", courses, "en", true);
  assert.equal(x.departures.length, 1);
  const y = setup({
    create: async () => {
      throw new Error("network");
    },
  });
  await y.flow.start("ecpay", courses, "en");
  assert.equal(y.flow.state().problem, "create");
  assert.deepEqual(
    y.flow.restore(y.flow.listDrafts()[0].id, false).courses,
    courses,
  );
  assert.equal(y.flow.listDrafts()[0].paymentId, undefined);
});
test("a return to the wrong local account stops before confirmation and resumes for its owner", async () => {
  let queries = 0;
  const x = setup({
    confirm: async () => {
      queries++;
      return { status: "paid" };
    },
  });
  await x.flow.start("stripe", courses, "en");
  const draft = x.flow.listDrafts()[0];
  const search = "?checkout=cancel&cc_attempt=" + draft.id;
  const bob = createCheckoutRecovery("bob", x.deps);
  await bob.handleReturn(search);
  assert.equal(bob.state().payment, "wrong-account");
  assert.equal(queries, 0);
  assert.deepEqual(bob.listDrafts(), []);
  const alice = createCheckoutRecovery("alice", x.deps);
  await alice.handleReturn(search);
  assert.equal(alice.state().payment, "paid");
  assert.equal(alice.state().preferredDraftId, draft.id);
});
test("pending confirmation stops at thirty seconds and manual retry can confirm without creating payment", async () => {
  let paid = false,
    creates = 0;
  const x = setup({
    create: async () => {
      creates++;
      throw new Error();
    },
    confirm: async () => ({ status: paid ? "paid" : "pending" }),
  });
  await x.flow.handleReturn("?ecpay_order=CC001");
  assert.equal(x.flow.state().payment, "pending");
  paid = true;
  await x.flow.recheck();
  assert.equal(x.flow.state().payment, "paid");
  await x.flow.handleReturn("?ecpay_order=CC001");
  assert.equal(creates, 0);
});
test("corrupt and unsupported drafts do not block valid recovery or payment confirmation", async () => {
  const x = setup();
  await x.flow.start("stripe", courses, "en");
  const [draft] = x.flow.listDrafts();
  x.storage.setItem("cc_checkout_v1:alice:broken", "{");
  x.storage.setItem(
    "cc_checkout_v1:alice:future",
    JSON.stringify({ ...draft, id: "future", version: 2 }),
  );
  const reopened = createCheckoutRecovery("alice", x.deps);
  await reopened.handleReturn("?checkout=success&session_id=cs_001");
  assert.equal(reopened.state().payment, "paid");
  assert.equal(reopened.state().problem, "draft");
  assert.equal(reopened.listDrafts().length, 1);
  assert.equal(reopened.restore("future", false).status, "unavailable");
  assert.deepEqual(reopened.restore(draft.id, false).courses, courses);
});
test("disposal ignores late confirmation and prevents another account receiving old results", async () => {
  let finish;
  const x = setup({
    confirm: () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  });
  const pending = x.flow.handleReturn("?ecpay_order=CC001");
  x.flow.dispose();
  finish({ status: "paid", usage: { userId: "alice" } });
  await pending;
  assert.equal(x.flow.state().payment, "checking");
  assert.equal(x.flow.state().usage, undefined);
});
test("overlapping starts and checks are coalesced and an empty schedule has no draft", async () => {
  let completeCreate,
    completeConfirm,
    creates = 0,
    confirms = 0;
  const x = setup({
    create: () => {
      creates++;
      return new Promise((resolve) => {
        completeCreate = resolve;
      });
    },
    confirm: () => {
      confirms++;
      return new Promise((resolve) => {
        completeConfirm = resolve;
      });
    },
  });
  const first = x.flow.start("stripe", [], "en");
  await x.flow.start("ecpay", courses, "en");
  completeCreate({
    provider: "stripe",
    paymentId: "cs_001",
    destination: "fixture",
  });
  await first;
  assert.equal(creates, 1);
  assert.equal(x.flow.listDrafts().length, 0);
  const pending = x.flow.recheck();
  const duplicate = x.flow.recheck();
  completeConfirm({ status: "paid" });
  await Promise.all([pending, duplicate]);
  assert.equal(confirms, 1);
});
test("failure saving the acquired payment association retries the same checkout", async () => {
  const x = setup();
  const write = x.storage.setItem;
  let failLink = true;
  x.storage.setItem = (k, v) => {
    const record = JSON.parse(v);
    if (failLink && record.courses && record.paymentId)
      throw new Error("quota");
    write(k, v);
  };
  await x.flow.start("ecpay", courses, "en");
  assert.equal(x.flow.state().problem, "save");
  assert.equal(x.departures.length, 0);
  failLink = false;
  x.deps.create = async () => {
    throw new Error("Must reuse acquired payment");
  };
  await x.flow.start("ecpay", courses, "en");
  assert.equal(x.departures.length, 1);
  assert.equal(x.flow.listDrafts().length, 1);
  assert.equal(x.flow.listDrafts()[0].paymentId, "CC001");
});
test("a hung confirmation request is bounded by thirty seconds", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const x = setup({ confirm: () => new Promise(() => {}) });
  const pending = x.flow.handleReturn("?ecpay_order=CC001");
  t.mock.timers.tick(30000);
  await pending;
  assert.equal(x.flow.state().payment, "unavailable");
});
test("a backend ownership rejection works without a local draft and never grants success", async () => {
  const x = setup({ confirm: async () => ({ status: "wrong-account" }) });
  await x.flow.handleReturn("?checkout=success&session_id=cs_unknown");
  assert.equal(x.flow.state().payment, "wrong-account");
  assert.equal(x.flow.state().usage, undefined);
});
test("retrying a prepared checkout preserves edits made after the save failure", async () => {
  const x = setup(),
    write = x.storage.setItem;
  let failLink = true;
  x.storage.setItem = (k, v) => {
    const d = JSON.parse(v);
    if (failLink && d.courses && d.paymentId) throw new Error("quota");
    write(k, v);
  };
  await x.flow.start("stripe", courses, "en");
  failLink = false;
  const revised = [{ ...courses[0], name: "New edit while waiting" }];
  await x.flow.start("stripe", revised, "en");
  assert.deepEqual(
    x.flow.restore(x.flow.listDrafts()[0].id, false).courses,
    revised,
  );
});
test("Stripe cancellation resolves the payment through the authenticated backend when browser storage is unavailable", async () => {
  const x = setup({
    resolveAttempt: async () => ({
      provider: "stripe",
      paymentId: "cs_from_backend",
    }),
  });
  x.storage.getItem = () => {
    throw new Error("storage disabled");
  };
  const reopened = createCheckoutRecovery("alice", x.deps);
  await reopened.handleReturn("?checkout=cancel&cc_attempt=opaque-attempt");
  assert.equal(reopened.state().payment, "paid");
  assert.equal(reopened.state().reference.paymentId, "cs_from_backend");
});
test(
  "disposing settles a confirmation even when the transport ignores cancellation",
  { timeout: 100 },
  async () => {
    const x = setup({ confirm: () => new Promise(() => {}) });
    const pending = x.flow.handleReturn("?ecpay_order=CC001");
    x.flow.dispose();
    await pending;
    assert.equal(x.flow.state().usage, undefined);
  },
);
test("backend return lookup prioritizes its original draft when local attempt hints are lost", async () => {
  let payment = 0;
  const x = setup({
    create: async (provider) => ({
      provider,
      paymentId: "cs_" + ++payment,
      destination: "fixture",
    }),
    resolveAttempt: async () => ({ provider: "stripe", paymentId: "cs_1" }),
  });
  await x.flow.start("stripe", courses, "en");
  const older = x.flow.listDrafts()[0];
  x.advance(100);
  await x.flow.start(
    "stripe",
    [{ ...courses[0], name: "Newer unrelated draft" }],
    "en",
  );
  for (const [key, value] of x.values)
    if (!JSON.parse(value).courses) x.storage.removeItem(key);
  const reopened = createCheckoutRecovery("alice", x.deps);
  await reopened.handleReturn("?checkout=cancel&cc_attempt=lost-local-hint");
  assert.equal(reopened.state().preferredDraftId, older.id);
});
