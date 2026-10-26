/* eslint-disable @typescript-eslint/no-require-imports */
const { test } = require("node:test"),
  assert = require("node:assert/strict");
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
const { createRecognitionBatch } = require("../lib/recognition-batch.ts");
const course = (name = "Math", location = "101") => ({
  name,
  professor: "Teacher",
  slots: [
    { weekday: "Monday", startTime: "09:00", endTime: "10:00", location },
  ],
});
function setup(overrides = {}) {
  let time = 1000,
    n = 0;
  const values = new Map(),
    sent = [],
    queries = [],
    updates = [];
  const deps = {
    storage: {
      getItem: (k) => values.get(k) ?? null,
      setItem: (k, v) => values.set(k, v),
      removeItem: (k) => values.delete(k),
    },
    now: () => time,
    id: () => `fixture-job-${++n}`,
    fingerprint: async (blob) => await blob.text(),
    submit: async (blob, id) => {
      sent.push({ text: await blob.text(), id });
      return {
        state: "succeeded",
        courses: [course()],
        usage: { remaining: 2 },
      };
    },
    query: async (id) => {
      queries.push(id);
      return { state: "pending" };
    },
    beginOperation: () => ({ finish: async (...x) => updates.push(x) }),
    ...overrides,
  };
  const flow = createRecognitionBatch("alice", deps);
  return {
    flow,
    deps,
    values,
    sent,
    queries,
    updates,
    advance: (ms) => (time += ms),
  };
}
async function prepared(x, names = ["one"]) {
  x.flow.open(names);
  const items = x.flow.getSnapshot().items;
  for (let i = 0; i < items.length; i++)
    await x.flow.prepared(items[i].id, new Blob([names[i]]));
  return items;
}
test("one prepared image becomes a candidate and requires explicit overwrite consent", async () => {
  const x = setup();
  await prepared(x);
  await x.flow.continue();
  assert.equal(x.flow.getSnapshot().items[0].status, "succeeded");
  assert.equal(x.sent.length, 1);
  assert.equal(x.flow.loadCandidate(true).status, "needs-confirmation");
  assert.deepEqual(x.flow.loadCandidate(true, true).courses, [course()]);
  assert.equal(x.updates.length, 1);
});
test("a later failure pauses the batch and preserves earlier successful results", async () => {
  let calls = 0;
  const x = setup({
    submit: async () =>
      ++calls === 1
        ? { state: "succeeded", courses: [course()] }
        : { state: "failed" },
  });
  await prepared(x, ["one", "two", "three"]);
  await x.flow.continue();
  assert.deepEqual(
    x.flow.getSnapshot().items.map((i) => i.status),
    ["succeeded", "failed", "ready"],
  );
  assert.equal(calls, 2);
  assert.equal(x.flow.getSnapshot().phase, "paused");
  assert.deepEqual(x.flow.loadCandidate(false).courses, [course()]);
});
test("only exact duplicate meetings disappear; other overlaps and adjacent meetings survive", async () => {
  const a = course(),
    b = course("Math", "102"),
    c = course("Similar mathematics");
  const adjacent = {
    ...course(),
    slots: [{ ...a.slots[0], startTime: "10:00", endTime: "11:00" }],
  };
  const x = setup({
    submit: async () => ({ state: "succeeded", courses: [a, b, c, adjacent] }),
  });
  await prepared(x, ["one", "two"]);
  await x.flow.continue();
  assert.equal(
    x.flow.loadCandidate(false).courses.flatMap((c) => c.slots).length,
    4,
  );
  assert.equal(x.flow.getSnapshot().overlap, true);
});
test("network uncertainty queries once, preserves the job, and never submits the next image", async () => {
  let posts = 0,
    checks = 0;
  const x = setup({
    submit: async () => {
      posts++;
      throw new Error("offline");
    },
    query: async () => {
      checks++;
      return { state: "not-found" };
    },
  });
  const items = await prepared(x, ["one", "two"]);
  await x.flow.continue();
  assert.equal(posts, 1);
  assert.equal(checks, 1);
  assert.deepEqual(
    x.flow.getSnapshot().items.map((i) => i.status),
    ["pending", "ready"],
  );
  x.deps.query = async () => ({
    state: "succeeded",
    courses: [course("Recovered")],
  });
  await x.flow.check(items[0].id);
  assert.equal(x.flow.getSnapshot().items[0].status, "succeeded");
  assert.equal(posts, 1);
});
test("retry and continue are explicit, and successful images are never resubmitted", async () => {
  let n = 0;
  const calls = [];
  const x = setup({
    submit: async (image, id) => {
      calls.push({ text: await image.text(), id });
      return ++n === 2
        ? { state: "failed" }
        : { state: "succeeded", courses: [course()] };
    },
  });
  const items = await prepared(x, ["one", "two", "three"]);
  await x.flow.continue();
  const old = calls[1].id;
  await x.flow.retry(items[1].id);
  assert.equal(calls.length, 3);
  assert.notEqual(calls[2].id, old);
  assert.equal(calls[2].text, "two");
  await x.flow.continue();
  assert.equal(calls.length, 4);
  assert.equal(calls[3].text, "three");
});
test("preparation failure prevents all submission until explicitly skipped or prepared", async () => {
  const x = setup();
  x.flow.open(["bad", "good"]);
  const [a, b] = x.flow.getSnapshot().items;
  x.flow.preparationFailed(a.id);
  x.flow.prepared(b.id, new Blob(["good"]));
  await x.flow.continue();
  assert.equal(x.sent.length, 0);
  x.flow.skip(a.id);
  await x.flow.continue();
  assert.equal(x.sent.length, 1);
  assert.equal(x.sent[0].text, "good");
});
test("storage failure blocks POST and preserves a retryable unsent identity", async () => {
  const x = setup();
  const write = x.deps.storage.setItem;
  let broken = true;
  x.deps.storage.setItem = (k, v) => {
    if (broken) throw new Error("quota");
    write(k, v);
  };
  const [item] = await prepared(x);
  await x.flow.continue();
  assert.equal(x.flow.getSnapshot().items[0].status, "storage-error");
  assert.equal(x.sent.length, 0);
  const id = x.flow.getSnapshot().items[0].jobId;
  broken = false;
  await x.flow.retry(item.id);
  assert.equal(x.sent.length, 1);
  assert.equal(x.sent[0].id, id);
});
test("reselecting an image in a new page queries the original hint; querying does not extend its age", async () => {
  const x = setup({ submit: async () => ({ state: "pending" }) });
  await prepared(x);
  await x.flow.continue();
  const hint = [...x.values.values()][0];
  x.advance(100);
  const reopened = createRecognitionBatch("alice", x.deps);
  reopened.open(["one"]);
  reopened.prepared(reopened.getSnapshot().items[0].id, new Blob(["one"]));
  await reopened.continue();
  assert.equal(x.queries.length, 1);
  assert.deepEqual([...x.values.values()], [hint]);
  const bob = createRecognitionBatch("bob", x.deps);
  bob.open(["one"]);
  bob.prepared(bob.getSnapshot().items[0].id, new Blob(["one"]));
  await bob.continue();
  assert.equal(x.values.size, 2);
});
test("expired and corrupt hints need explicit new-job consent; legacy references are queried first", async () => {
  const x = setup({ submit: async () => ({ state: "pending" }) });
  const [a] = await prepared(x);
  await x.flow.continue();
  x.flow.end();
  x.advance(7 * 86400000);
  await prepared(x);
  await x.flow.continue();
  assert.equal(x.flow.getSnapshot().items[0].status, "needs-confirmation");
  const id = x.flow.getSnapshot().items[0].id;
  await x.flow.confirmNew(id, false);
  assert.equal(x.flow.getSnapshot().items[0].status, "needs-confirmation");
  await x.flow.confirmNew(id, true);
  assert.equal(x.flow.getSnapshot().items[0].status, "pending");
  const key = [...x.values.keys()][0];
  x.values.set(key, "legacy-job-123");
  x.flow.end();
  await prepared(x);
  await x.flow.continue();
  assert.equal(x.queries.at(-1), "legacy-job-123");
  x.values.set(key, "{broken");
  x.flow.end();
  await prepared(x);
  await x.flow.continue();
  assert.equal(x.flow.getSnapshot().items[0].status, "needs-confirmation");
  assert.ok(a.id);
});
test("ending a running batch stops later images but still forwards the completed account result", async () => {
  let done;
  const x = setup({
    submit: () =>
      new Promise((resolve) => {
        done = resolve;
      }),
  });
  await prepared(x, ["one", "two"]);
  const running = x.flow.continue();
  await new Promise((resolve) => setImmediate(resolve));
  x.flow.end();
  done({ state: "succeeded", courses: [course()], usage: { remaining: 2 } });
  await running;
  assert.equal(x.flow.getSnapshot().phase, "ended");
  assert.equal(x.flow.getSnapshot().candidate.length, 0);
  assert.equal(x.updates.length, 1);
});
test("submission and lookup waiting are bounded without declaring the server job failed", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const x = setup({
    submit: () => new Promise(() => {}),
    query: () => new Promise(() => {}),
  });
  await prepared(x);
  const running = x.flow.continue();
  await new Promise((resolve) => setImmediate(resolve));
  t.mock.timers.tick(90000);
  await new Promise((resolve) => setImmediate(resolve));
  t.mock.timers.tick(15000);
  await running;
  assert.equal(x.flow.getSnapshot().items[0].status, "pending");
  assert.equal(x.flow.getSnapshot().phase, "paused");
});
test("disposing removes preparation targets so a late image cannot attach to an old account", async () => {
  const x = setup();
  x.flow.open(["one"]);
  const id = x.flow.getSnapshot().items[0].id;
  x.flow.dispose();
  x.flow.prepared(id, new Blob(["late"]));
  assert.equal(x.flow.getSnapshot().items.length, 0);
});
test("job lookup authentication failure keeps an existing job pending instead of deleting its reference", async () => {
  const x = setup({
    submit: async () => ({ state: "pending" }),
    query: async () => ({ state: "auth", status: 401 }),
  });
  const [item] = await prepared(x);
  await x.flow.continue();
  const before = [...x.values.values()];
  await x.flow.check(item.id);
  assert.equal(x.flow.getSnapshot().items[0].status, "pending");
  assert.deepEqual([...x.values.values()], before);
});
test("an old completion cannot remove a newer same-image reference written by another tab", async () => {
  const x = setup({ submit: async () => ({ state: "pending" }) });
  const [item] = await prepared(x);
  await x.flow.continue();
  let release;
  const wait = new Promise((resolve) => (release = resolve));
  x.deps.query = () => wait;
  const old = x.flow.check(item.id);
  await new Promise((resolve) => setImmediate(resolve));
  x.deps.query = async () => ({ state: "succeeded", courses: [course()] });
  const other = createRecognitionBatch("alice", x.deps);
  other.open(["one"]);
  other.prepared(other.getSnapshot().items[0].id, new Blob(["one"]));
  await other.continue();
  other.open(["one"]);
  other.prepared(other.getSnapshot().items[0].id, new Blob(["one"]));
  await other.continue();
  const newer = [...x.values.values()];
  assert.equal(newer.length, 1);
  release({ state: "succeeded", courses: [course()] });
  await old;
  assert.deepEqual([...x.values.values()], newer);
});
test("immediate reconnect allows preparing a new batch before old request cleanup settles", async () => {
  const x = setup({ submit: () => new Promise(() => {}) });
  await prepared(x);
  const old = x.flow.continue();
  await new Promise((resolve) => setImmediate(resolve));
  x.flow.dispose();
  x.flow.start();
  x.flow.open(["new"]);
  const item = x.flow.getSnapshot().items[0];
  x.flow.prepared(item.id, new Blob(["new"]));
  assert.equal(x.flow.getSnapshot().items[0].status, "ready");
  await old;
});
test("a prepared image fingerprint failure can be retried before its first submission", async () => {
  let broken = true;
  const x = setup({
    fingerprint: async () => {
      if (broken) throw new Error("read failed");
      return "one";
    },
  });
  const [item] = await prepared(x);
  await x.flow.continue();
  assert.equal(x.flow.getSnapshot().items[0].status, "prepare-error");
  broken = false;
  await x.flow.retry(item.id);
  assert.equal(x.sent.length, 1);
  assert.equal(x.flow.getSnapshot().items[0].status, "succeeded");
});
test("retrying fingerprint preparation must query an already pending same-image job", async () => {
  const x = setup({ submit: async () => ({ state: "pending" }) });
  await prepared(x);
  await x.flow.continue();
  const hints = [...x.values.values()];
  x.flow.end();
  let broken = true;
  x.deps.fingerprint = async () => {
    if (broken) throw new Error("read failed");
    return "one";
  };
  const [item] = await prepared(x);
  await x.flow.continue();
  broken = false;
  await x.flow.retry(item.id);
  assert.equal(x.queries.length, 1);
  assert.deepEqual([...x.values.values()], hints);
});
