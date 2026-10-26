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
const { createScheduleRecognizer } = require("../lib/parse-schedule.ts");
const image = { mimeType: "image/png", base64: "fixture" };
const context = {
  accountId: "fixture-account",
  jobId: "recognition-fixture-01",
  creditBucket: "free",
};
function payload(
  courses = [{ name: "Math", day: 1, periods: ["C", "D"], room: "101" }],
) {
  return {
    scratchpad: {
      columns: [1, 2, 3, 4, 5].map((column) => ({
        column,
        occupancy: courses.some((c) => c.day === column)
          ? "Has Courses"
          : "Empty Column",
      })),
      cells: courses.map((c) => ({
        name: c.name,
        column: c.day,
        codes: c.periods,
      })),
    },
    courses,
  };
}
function setup(data = payload(), options = {}) {
  const records = [];
  let calls = 0;
  const recognize = createScheduleRecognizer({
    model: async () => {
      calls++;
      return {
        content: JSON.stringify(data),
        model: "gpt-4o",
        inputTokens: 12,
        outputTokens: 8,
        latencyMs: 5,
      };
    },
    record: async (record) => {
      records.push(record);
    },
    ...options,
  });
  return { recognize, records, calls: () => calls };
}
test("one interface returns editable courses, joins adjacent same-room periods and records the job", async () => {
  const f = setup();
  const result = await f.recognize(image, context);
  assert.deepEqual(result, [
    {
      name: "Math",
      professor: "",
      slots: [
        {
          weekday: "Monday",
          startTime: "10:15",
          endTime: "13:00",
          location: "101",
        },
      ],
    },
  ]);
  assert.equal(f.calls(), 1);
  assert.equal(f.records[0].jobId, context.jobId);
  assert.equal(f.records[0].normalizationStatus, "succeeded");
  assert.equal(f.records[0].inputTokens, 12);
});
test("normalizes unambiguous formatting, preserves a blank weekday and never invents a classroom", async () => {
  const f = setup(
    payload([
      { name: "  English   I ", day: 3, periods: [" c ", "d"], room: "" },
    ]),
  );
  const courses = await f.recognize(image, context);
  assert.equal(courses[0].name, "English I");
  assert.deepEqual(courses[0].slots, [
    {
      weekday: "Wednesday",
      startTime: "10:15",
      endTime: "13:00",
      location: "",
    },
  ]);
});
test("unknown period in one of several courses rejects the whole recognition, not a partial success", async () => {
  const f = setup(
    payload([
      { name: "Math", day: 1, periods: ["C"], room: "" },
      { name: "English", day: 2, periods: ["K"], room: "" },
    ]),
  );
  await assert.rejects(f.recognize(image, context), { code: "unknown_period" });
  assert.equal(f.records[0].normalizationStatus, "failed");
  assert.equal(f.records[0].courseCount, 0);
  assert.equal(f.records[0].inputTokens, 12);
});
test("rejects missing/duplicate weekday columns and scratchpad/course contradictions", async () => {
  const missing = payload();
  missing.scratchpad.columns.pop();
  const duplicate = payload();
  duplicate.scratchpad.columns[1].column = 1;
  const moved = payload();
  moved.courses[0].day = 2;
  const changed = payload();
  changed.scratchpad.cells[0].codes = ["E"];
  const coerced = payload();
  coerced.scratchpad.columns[0].occupancy = ["Has Courses"];
  const falseEmpty = payload();
  falseEmpty.scratchpad.columns[0].occupancy = "Empty Column";
  for (const [data, code] of [
    [missing, "invalid_columns"],
    [duplicate, "invalid_columns"],
    [moved, "inconsistent_columns"],
    [changed, "inconsistent_columns"],
    [falseEmpty, "inconsistent_columns"],
    [coerced, "invalid_columns"],
  ]) {
    const f = setup(data);
    await assert.rejects(f.recognize(image, context), { code });
    assert.equal(f.records[0].normalizationStatus, "failed");
  }
});
test("keeps discrete periods and classrooms, merges only consecutive same-table same-room periods", async () => {
  const rows = [
    { name: "Math", day: 1, periods: ["C", "E"], room: "101" },
    { name: "Math", day: 1, periods: ["D"], room: "202" },
    { name: "Math", day: 2, periods: ["01", "02"], room: "" },
  ];
  const result = await setup(payload(rows)).recognize(image, context);
  assert.equal(result.length, 1);
  assert.deepEqual(result[0].slots, [
    {
      weekday: "Monday",
      startTime: "10:15",
      endTime: "11:30",
      location: "101",
    },
    {
      weekday: "Monday",
      startTime: "11:45",
      endTime: "13:00",
      location: "202",
    },
    {
      weekday: "Monday",
      startTime: "13:15",
      endTime: "14:30",
      location: "101",
    },
    { weekday: "Tuesday", startTime: "07:10", endTime: "09:00", location: "" },
  ]);
});
test("deduplicates exact meetings without filling a blank classroom or merging across period tables", async () => {
  const rows = [
    { name: "Math", day: 1, periods: ["C"], room: "101" },
    { name: "Math", day: 1, periods: ["C"], room: "101" },
    { name: "Math", day: 1, periods: ["D"], room: "" },
    { name: "Math", day: 1, periods: ["8"], room: "101" },
  ];
  const result = await setup(payload(rows)).recognize(image, context);
  assert.equal(result[0].slots.length, 3);
  assert.equal(result[0].slots[1].location, "");
  assert.equal(result[0].slots[2].startTime, "14:10");
});
test("rejects same-course cross-table overlap and competing classrooms, preserves different-course clashes", async () => {
  for (const [rows, code] of [
    [
      [{ name: "English", day: 1, periods: ["B", "3"], room: "101" }],
      "period_conflict",
    ],
    [
      [
        { name: "English", day: 1, periods: ["C"], room: "101" },
        { name: "English", day: 1, periods: ["C"], room: "202" },
      ],
      "room_conflict",
    ],
  ])
    await assert.rejects(setup(payload(rows)).recognize(image, context), {
      code,
    });
  const result = await setup(
    payload([
      { name: "English", day: 1, periods: ["C"], room: "101" },
      { name: "English II", day: 1, periods: ["C"], room: "202" },
    ]),
  ).recognize(image, context);
  assert.equal(result.length, 2);
  assert.equal(result[1].name, "English II");
});
test("records known model usage on invalid content, unknown usage on transport failure, and never exposes raw errors", async () => {
  for (const content of ["", "{invalid json"]) {
    const f = setup(null, {
      model: async () => ({
        content,
        model: "gpt-4o",
        inputTokens: 17,
        outputTokens: 2,
        latencyMs: 6,
      }),
    });
    await assert.rejects(f.recognize(image, context), {
      code: "invalid_response",
    });
    assert.equal(f.records[0].inputTokens, 17);
    assert.equal(f.records[0].modelStatus, "responded");
    assert.equal(f.records[0].normalizationStatus, "failed");
    assert.equal("content" in f.records[0], false);
  }
  const f = setup(null, {
    model: async () => {
      throw new Error("provider secret body sk_do_not_leak");
    },
  });
  await assert.rejects(
    f.recognize(image, context),
    (e) => e.code === "model_failed" && !e.message.includes("sk_do_not_leak"),
  );
  assert.equal(f.records[0].inputTokens, null);
  assert.equal(f.records[0].outputTokens, null);
  assert.equal(f.records[0].modelStatus, "failed");
});
test("logging failure prevents success without a second model call", async () => {
  let calls = 0;
  const f = setup(payload(), {
    model: async () => {
      calls++;
      return {
        content: JSON.stringify(payload()),
        model: "gpt-4o",
        inputTokens: 12,
        outputTokens: 8,
        latencyMs: 5,
      };
    },
    record: async () => {
      throw new Error("private database details");
    },
  });
  await assert.rejects(
    f.recognize(image, context),
    (e) => e.code === "logging_failed" && !e.message.includes("private"),
  );
  assert.equal(calls, 1);
});
test("bounds model and record waiting even if an adapter ignores cancellation", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  try {
    const f = setup(null, { model: () => new Promise(() => {}) });
    const outcome = f.recognize(image, context);
    const assertion = assert.rejects(outcome, { code: "model_timeout" });
    t.mock.timers.tick(45000);
    await assertion;
    assert.equal(f.records[0].inputTokens, null);
    let entered;
    const recording = new Promise((resolve) => {
      entered = resolve;
    });
    const g = setup(payload(), {
      record: () => {
        entered();
        return new Promise(() => {});
      },
    });
    const waiting = g.recognize(image, context);
    const rejected = assert.rejects(waiting, { code: "logging_failed" });
    await recording;
    t.mock.timers.tick(15000);
    await rejected;
  } finally {
    t.mock.timers.reset();
  }
});

test("rejects malformed course entries and empty results without losing a known model call", async () => {
  const variants = [
    [
      payload([{ name: "Math", day: 6, periods: ["C"], room: "" }]),
      "invalid_day",
    ],
    [
      payload([{ name: " ", day: 1, periods: ["C"], room: "" }]),
      "missing_name",
    ],
    [
      payload([{ name: "Math", day: 1, periods: [], room: "" }]),
      "missing_periods",
    ],
    [payload([]), "empty_result"],
    [{ courses: [null] }, "invalid_response"],
  ];
  for (const [data, code] of variants) {
    const f = setup(data);
    await assert.rejects(f.recognize(image, context), { code });
    assert.equal(f.records[0].inputTokens, 12);
    assert.equal(f.records[0].eventCount, 0);
  }
});
test("normalization is independent of period order, preserves legacy name cleanup and does not guess O", async () => {
  const f = setup(
    payload([
      {
        name: "(C)  English   I",
        day: 1,
        periods: ["d", " C ", "C"],
        room: "",
      },
    ]),
  );
  const [course] = await f.recognize(image, context);
  assert.equal(course.name, "English I");
  assert.equal(course.slots.length, 1);
  assert.equal(course.slots[0].startTime, "10:15");
  assert.equal(course.slots[0].endTime, "13:00");
  await assert.rejects(
    setup(
      payload([{ name: "English", day: 1, periods: ["O"], room: "" }]),
    ).recognize(image, context),
    { code: "unknown_period" },
  );
});
test("treats known empty-room and nonempty-room observations as distinct without guessing", async () => {
  const [course] = await setup(
    payload([
      { name: "Math", day: 1, periods: ["C"], room: "" },
      { name: "Math", day: 1, periods: ["C"], room: "101" },
    ]),
  ).recognize(image, context);
  assert.equal(course.slots.length, 2);
  assert.deepEqual(
    course.slots.map((s) => s.location),
    ["", "101"],
  );
});
test("production recording adapter accepts unknown usage without fabricating numeric legacy records", async () => {
  const os = require("node:os");
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "cc-recognition-storage-"));
  process.env.TURSO_DATABASE_URL = "file:" + path.join(dir, "logs.db");
  process.env.TURSO_AUTH_TOKEN = "local-fixture";
  const turso = require("../lib/turso.ts");
  const db = turso.getTurso();
  try {
    // The pre-existing consumer schema remains numeric-only and untouched.
    await db.execute(
      "CREATE TABLE ai_logs(id TEXT PRIMARY KEY,site_id TEXT,model TEXT,input_tokens INTEGER NOT NULL,output_tokens INTEGER NOT NULL,latency_ms INTEGER,status TEXT,metadata TEXT)",
    );
    const model = async () => ({
      content: JSON.stringify(payload()),
      model: "gpt-4o",
      inputTokens: null,
      outputTokens: null,
      latencyMs: 5,
    });
    const f = setup(null, { model, record: turso.logRecognitionUsage });
    assert.equal(
      (await f.recognize(image, { ...context, jobId: "unknown-usage-job" }))
        .length,
      1,
    );
    // Job IDs are scoped to accounts in the account ledger, including the logs.
    assert.equal(
      (
        await f.recognize(image, {
          ...context,
          accountId: "another-account",
          jobId: "unknown-usage-job",
        })
      ).length,
      1,
    );
    const known = setup(payload(), { record: turso.logRecognitionUsage });
    assert.equal(
      (await known.recognize(image, { ...context, jobId: "known-usage-job" }))
        .length,
      1,
    );
    await db.execute("DROP TABLE ai_logs");
    await assert.rejects(
      known.recognize(image, { ...context, jobId: "failed-record-job" }),
      { code: "logging_failed" },
    );
  } finally {
    db.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
