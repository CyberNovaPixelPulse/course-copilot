/* eslint-disable @typescript-eslint/no-require-imports */
const { test } = require("node:test"),
  assert = require("node:assert/strict"),
  fs = require("node:fs"),
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
const { createCalendarExport } = require("../lib/calendar-export.ts");
const courses = (name = "A") => [
  {
    name,
    professor: "Teacher",
    slots: [
      {
        weekday: "Monday",
        startTime: "07:10",
        endTime: "08:00",
        location: "101",
      },
    ],
  },
];
const ics =
  "BEGIN:VCALENDAR\r\nVERSION:2.0\r\nBEGIN:VEVENT\r\nSUMMARY:A\r\nEND:VEVENT\r\nEND:VCALENDAR\r\n";
const response = (body = ics) => ({
  status: 200,
  contentType: "text/calendar; charset=utf-8",
  body,
});
const deferred = () => {
  let resolve;
  const promise = new Promise((r) => (resolve = r));
  return { promise, resolve };
};
function setup(overrides = {}) {
  const calls = [],
    deliveries = [],
    images = [],
    access = [],
    timers = new Map();
  let n = 0;
  const deps = {
    prepare: async (c) => {
      calls.push(c);
      return response();
    },
    deliver: (body, method) => deliveries.push({ body, method }),
    renderImage: async (c) => {
      images.push(c);
      return new Blob(["image"]);
    },
    access: (kind) => access.push(kind),
    setTimer: (fn) => {
      timers.set(++n, fn);
      return n;
    },
    clearTimer: (id) => timers.delete(id),
    ...overrides,
  };
  return {
    flow: createCalendarExport("alice", deps),
    calls,
    deliveries,
    images,
    access,
    timers,
  };
}
test("one fixed snapshot produces one request and one initial download despite repeated clicks or later edits", async () => {
  const wait = deferred(),
    sent = [];
  const x = setup({
      prepare: (c) => {
        sent.push(c);
        return wait.promise;
      },
    }),
    source = courses();
  const first = x.flow.start(source);
  source[0].name = "B";
  await x.flow.start(source);
  assert.equal(sent.length, 1);
  wait.resolve(response());
  await first;
  assert.equal(x.flow.getSnapshot().result.courses[0].name, "A");
  assert.deepEqual(x.deliveries, [{ body: ics, method: "download" }]);
  x.flow.close();
  x.flow.reopen();
  await x.flow.start(source);
  assert.equal(x.deliveries.length, 1);
  assert.equal(sent.length, 1);
});
test("only a usable calendar response reaches delivery; invalid schedules never request a file", async () => {
  for (const value of [
    { status: 500, contentType: "text/calendar", body: ics },
    { status: 200, contentType: "text/html", body: ics },
    response(""),
    response("<html>error</html>"),
    response("BEGIN:VCALENDAR\r\n"),
  ]) {
    const x = setup({ prepare: async () => value });
    await x.flow.start(courses());
    assert.equal(x.flow.getSnapshot().problem.kind, "prepare");
    assert.equal(x.deliveries.length, 0);
  }
  const x = setup();
  await x.flow.start([]);
  assert.equal(x.flow.getSnapshot().problem.kind, "invalid");
  assert.equal(x.calls.length, 0);
});
test("replacing an export and disposing its account prevent late responses from handing off", async () => {
  const old = deferred();
  let n = 0;
  const x = setup({
    prepare: () =>
      ++n === 1
        ? old.promise
        : Promise.resolve(response(ics.replace("SUMMARY:A", "SUMMARY:B"))),
  });
  const first = x.flow.start(courses("A"));
  await x.flow.start(courses("B"), true);
  old.resolve(response());
  await first;
  assert.equal(x.flow.getSnapshot().result.courses[0].name, "B");
  assert.equal(x.deliveries.length, 1);
  const held = deferred(),
    y = setup({ prepare: () => held.promise });
  const task = y.flow.start(courses());
  y.flow.dispose();
  held.resolve(response());
  await task;
  assert.equal(y.deliveries.length, 0);
  assert.equal(y.flow.getSnapshot().result, null);
});
test("thirty-second preparation timeout settles even an uncooperative transport; retry keeps original snapshot", async () => {
  const held = deferred();
  let n = 0;
  const sent = [];
  const x = setup({
    prepare: (c) => {
      sent.push(c);
      return ++n === 1 ? held.promise : Promise.resolve(response());
    },
  });
  const task = x.flow.start(courses());
  assert.equal(x.timers.size, 1);
  [...x.timers.values()][0]();
  await task;
  assert.equal(x.flow.getSnapshot().problem.kind, "prepare");
  assert.equal(x.deliveries.length, 0);
  await x.flow.retry();
  held.resolve(response());
  await Promise.resolve();
  assert.equal(sent.length, 2);
  assert.equal(sent[1][0].name, "A");
  assert.equal(x.deliveries.length, 1);
});
test("authentication, payment and delivery failures offer distinct recovery; prepared files are reused", async () => {
  for (const [status, kind] of [
    [401, "auth"],
    [402, "payment"],
  ]) {
    const x = setup({
      prepare: async () => ({
        status,
        contentType: "application/json",
        body: "{}",
      }),
    });
    await x.flow.start(courses());
    assert.equal(x.flow.getSnapshot().problem.kind, kind);
    assert.deepEqual(x.access, [kind]);
    assert.equal(x.deliveries.length, 0);
  }
  let fail = true;
  const x = setup({
    deliver: () => {
      if (fail) throw new Error("blocked");
    },
  });
  await x.flow.start(courses());
  assert.equal(x.flow.getSnapshot().problem.kind, "delivery");
  assert.ok(x.flow.getSnapshot().result);
  fail = false;
  await x.flow.deliver("download");
  assert.equal(x.calls.length, 1);
  assert.equal(x.flow.getSnapshot().problem, null);
});
test("share image failure is independent of ICS and retry never prepares another calendar", async () => {
  let fail = true;
  const x = setup({
    renderImage: async () => {
      if (fail) throw new Error("canvas failed");
      return new Blob(["A"]);
    },
  });
  await x.flow.start(courses());
  assert.equal(x.flow.getSnapshot().image.phase, "error");
  assert.equal(x.deliveries.length, 1);
  fail = false;
  await x.flow.retryImage();
  assert.equal(await x.flow.getSnapshot().image.blob.text(), "A");
  assert.equal(x.calls.length, 1);
});
test("late images cannot replace the newer export and disposed stores can reconnect safely", async () => {
  const held = deferred();
  let n = 0;
  const x = setup({
    renderImage: async (c) =>
      ++n === 1 ? held.promise : new Blob([c[0].name]),
  });
  await x.flow.start(courses());
  await x.flow.start(courses("B"), true);
  held.resolve(new Blob(["A"]));
  await Promise.resolve();
  await Promise.resolve();
  assert.equal(await x.flow.getSnapshot().image.blob.text(), "B");
  assert.equal(x.flow.matches(courses("B")), true);
  assert.equal(x.flow.matches(courses("A")), false);
  x.flow.dispose();
  x.flow.connect();
  await x.flow.start(courses("C"));
  assert.equal(x.flow.getSnapshot().result.courses[0].name, "C");
});
test("timeout marks an operation stale before abort callbacks can resolve it successfully", async () => {
  const x = setup({
    prepare: (_, signal) =>
      new Promise((resolve) =>
        signal.addEventListener("abort", () => resolve(response())),
      ),
  });
  const task = x.flow.start(courses());
  [...x.timers.values()][0]();
  await task;
  assert.equal(x.deliveries.length, 0);
  assert.equal(x.flow.getSnapshot().phase, "error");
});
test("delivery refactor preserves existing dates, floating times, weekly count and event identity", () => {
  const { coursesToIcs } = require("../lib/ics.ts");
  const text = coursesToIcs(courses("Math"), {
    from: new Date(2026, 9, 26, 20, 0),
  });
  assert.match(text, /DTSTART:20261026T071000\r\n/);
  assert.match(text, /DTEND:20261026T080000\r\n/);
  assert.match(text, /RRULE:FREQ=WEEKLY;COUNT=16/);
  assert.match(text, /UID:math-Monday-0710-0-0@course-copilot/);
  assert.doesNotMatch(text, /TZID=/);
});
test("preparation timeout ends when file arrives, independently of delivery and image work", async () => {
  const held = deferred(),
    x = setup({ deliver: () => held.promise });
  const task = x.flow.start(courses());
  await Promise.resolve();
  await Promise.resolve();
  assert.ok(x.flow.getSnapshot().result);
  assert.equal(x.timers.size, 0);
  held.resolve();
  await task;
});
test("repeated explicit replacement with the identical pending snapshot is coalesced", async () => {
  const held = deferred(),
    sent = [];
  const x = setup({
    prepare: (c) => {
      sent.push(c);
      return held.promise;
    },
  });
  const first = x.flow.start(courses()),
    second = x.flow.start(courses(), true);
  assert.equal(sent.length, 1);
  held.resolve(response());
  await Promise.all([first, second]);
  assert.equal(x.deliveries.length, 1);
});
