/* eslint-disable @typescript-eslint/no-require-imports */
const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs"),
  ts = require("typescript");
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
const { createEntitlementDisplay } = require("../lib/entitlement-display.ts");
const usage = (free = 3, paid = 0, canExport = false) => ({
  userId: "alice",
  freeScansRemaining: free,
  gpt4oRemaining: paid,
  remaining: free + paid,
  canExportIcs: canExport,
  paid: canExport,
  stripeCheckoutEnabled: true,
});
function deferred() {
  let resolve, reject;
  const promise = new Promise((a, b) => {
    resolve = a;
    reject = b;
  });
  return { promise, resolve, reject };
}
function setup(read = async () => usage()) {
  let reads = 0,
    notifications = 0;
  const store = createEntitlementDisplay("alice", {
    read: (signal) => {
      reads++;
      return read(signal);
    },
    notify: () => {
      notifications++;
    },
  });
  return { store, reads: () => reads, notifications: () => notifications };
}
test("readers share one in-memory query and receive complete credit and export snapshots", async () => {
  const waiting = deferred(),
    x = setup(() => waiting.promise);
  const first = x.store.refresh(),
    second = x.store.refresh();
  assert.equal(x.reads(), 1);
  assert.equal(x.store.getSnapshot().snapshot, null);
  waiting.resolve(usage(0, 0, true));
  await Promise.all([first, second]);
  assert.deepEqual(x.store.getSnapshot().snapshot, {
    accountId: "alice",
    freeRemaining: 0,
    creditRemaining: 0,
    totalRemaining: 0,
    canExport: true,
    stripeCheckoutEnabled: true,
  });
  assert.equal(x.store.getSnapshot().status, "ready");
  assert.equal(setup().store.getSnapshot().snapshot, null);
});
test("confirmed operation updates immediately and an older query cannot overwrite it", async () => {
  const old = deferred(),
    x = setup(() => old.promise);
  const pending = x.store.refresh();
  const op = x.store.beginOperation();
  await op.finish(usage(2, 30, true));
  assert.equal(x.store.getSnapshot().snapshot.totalRemaining, 32);
  old.resolve(usage());
  await pending;
  assert.equal(x.store.getSnapshot().snapshot.totalRemaining, 32);
  assert.equal(x.notifications(), 1);
});
test("overlapping operations converge after the last success or failure and allow legitimate decreases", async () => {
  const x = setup(async () => usage(1, 29, true));
  const a = x.store.beginOperation(),
    b = x.store.beginOperation();
  await a.finish(usage(3, 30, true));
  assert.equal(x.reads(), 0);
  assert.equal(x.store.getSnapshot().status, "updating");
  await b.finish(undefined, 503);
  assert.equal(x.reads(), 1);
  assert.equal(x.store.getSnapshot().snapshot.totalRemaining, 30);
  assert.equal(x.store.getSnapshot().status, "ready");
});
test("changes during a query coalesce into one follow-up while ordinary retries share it", async () => {
  const a = deferred(),
    b = deferred();
  let call = 0;
  const x = setup(() => (++call === 1 ? a.promise : b.promise));
  const waiting = x.store.refresh();
  x.store.refresh("changed");
  x.store.refresh("changed");
  x.store.refresh();
  a.resolve(usage());
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(x.reads(), 2);
  b.resolve(usage(2));
  await waiting;
  assert.equal(x.store.getSnapshot().snapshot.totalRemaining, 2);
  assert.equal(x.notifications(), 0);
});
test("two successful overlapping results are followed by one authoritative read", async () => {
  const x = setup(async () => usage(1, 29, true)),
    a = x.store.beginOperation(),
    b = x.store.beginOperation();
  await b.finish(usage(2, 29, true));
  await a.finish(usage(3, 30, true));
  assert.equal(x.reads(), 1);
  assert.equal(x.store.getSnapshot().snapshot.totalRemaining, 30);
});
test("malformed snapshots retain the last complete value; errors are never zero credits", async () => {
  let data = usage();
  const x = setup(async () => data);
  await x.store.refresh();
  for (const bad of [
    { ...usage(), remaining: 99 },
    { ...usage(), freeScansRemaining: -1 },
    { ...usage(), gpt4oRemaining: undefined },
    { ...usage(), canExportIcs: "yes" },
  ]) {
    data = bad;
    await x.store.refresh();
    assert.equal(x.store.getSnapshot().status, "error");
    assert.equal(x.store.getSnapshot().snapshot.totalRemaining, 3);
  }
  const fresh = setup(async () => {
    throw new Error("offline");
  });
  await fresh.store.refresh();
  assert.equal(fresh.store.getSnapshot().snapshot, null);
  assert.equal(fresh.store.getSnapshot().status, "error");
  data = usage(2);
  await x.store.refresh();
  assert.equal(x.store.getSnapshot().snapshot.totalRemaining, 2);
});
test("a 401 clears the login stage and its late operations cannot restore it", async () => {
  const x = setup();
  await x.store.refresh();
  const old = x.store.beginOperation(),
    failed = x.store.beginOperation();
  await failed.finish(undefined, 401);
  assert.equal(x.store.getSnapshot().snapshot, null);
  assert.equal(x.store.getSnapshot().status, "sign-in");
  await old.finish(usage(3, 30, true));
  await x.store.refresh();
  assert.equal(x.store.getSnapshot().snapshot, null);
});
test("disposing aborts an old login stage even when transport ignores the signal", async () => {
  const old = deferred(),
    x = setup(() => old.promise);
  const wait = x.store.refresh();
  const op = x.store.beginOperation();
  x.store.dispose();
  await wait;
  old.resolve(usage(3, 30, true));
  await op.finish(usage(3, 30, true));
  assert.equal(x.store.getSnapshot().snapshot, null);
  const other = createEntitlementDisplay("bob", {
    read: async () => ({ ...usage(2), userId: "bob" }),
    notify: () => {},
  });
  await other.refresh();
  assert.equal(other.getSnapshot().snapshot.accountId, "bob");
});
test("another account payload is ignored without turning the current account into an error", async () => {
  const x = setup();
  await x.store.refresh();
  await x.store.beginOperation().finish({ ...usage(9), userId: "bob" });
  assert.equal(x.store.getSnapshot().status, "ready");
  assert.equal(x.store.getSnapshot().snapshot.totalRemaining, 3);
});
test("legacy complete shapes are translated centrally without inferring missing credits as zero", async () => {
  const old = { ...usage(2, 8, true) };
  delete old.remaining;
  delete old.canExportIcs;
  const x = setup(async () => ({ usage: old }));
  await x.store.refresh();
  assert.equal(x.store.getSnapshot().snapshot.totalRemaining, 10);
  assert.equal(x.store.getSnapshot().snapshot.canExport, true);
});
test("a failed refresh from an invalidated old query cannot replace a confirmed result", async () => {
  const wait = deferred(),
    x = setup(() => wait.promise),
    pending = x.store.refresh();
  await x.store.beginOperation().finish(usage(2, 20, true));
  wait.reject(new Error("old failure"));
  await pending;
  assert.equal(x.store.getSnapshot().status, "ready");
  assert.equal(x.store.getSnapshot().snapshot.totalRemaining, 22);
});
test("immediate reconnect starts a fresh query and old cleanup cannot erase it", async () => {
  const first = deferred(),
    second = deferred();
  let call = 0;
  const x = setup(() => (++call === 1 ? first.promise : second.promise));
  const old = x.store.start();
  x.store.dispose();
  const fresh = x.store.start();
  await old;
  assert.equal(x.reads(), 2);
  const same = x.store.refresh();
  assert.equal(x.reads(), 2);
  second.resolve(usage(2));
  await Promise.all([fresh, same]);
  assert.equal(x.store.getSnapshot().snapshot.totalRemaining, 2);
});
test("a changed hint after an operation marks a queued follow-up as updating", async () => {
  const old = deferred(),
    fresh = deferred();
  let call = 0;
  const x = setup(() => (++call === 1 ? old.promise : fresh.promise));
  const pending = x.store.refresh();
  await x.store.beginOperation().finish(usage(2, 10, true));
  x.store.refresh("changed");
  assert.equal(x.store.getSnapshot().status, "updating");
  old.resolve(usage());
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(x.reads(), 2);
  assert.equal(x.store.getSnapshot().status, "updating");
  fresh.resolve(usage(1, 10, true));
  await pending;
  assert.equal(x.store.getSnapshot().status, "ready");
});
