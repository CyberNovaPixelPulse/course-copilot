/* eslint-disable @typescript-eslint/no-require-imports */
const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const Module = require("node:module");
const ts = require("typescript");
const resolver = Module._resolveFilename;
Module._resolveFilename = function (id, ...args) {
  return resolver.call(
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
const { NextRequest } = require("next/server");
const db = createClient({ url: ":memory:" });
const turso = require("../lib/turso.ts");
turso.getTurso = () => db;
let session = { user: { id: "route-user" } };
require("../lib/session.ts").getGoogleSession = async () => session;
let calls = 0,
  logFailure = false,
  recognize;
const parser = require("../lib/parse-schedule.ts");
const fixture = {
  scratchpad: {
    columns: [1, 2, 3, 4, 5].map((column) => ({
      column,
      occupancy: column === 1 ? "Has Courses" : "Empty Column",
    })),
    cells: [{ name: "Math", column: 1, codes: ["C"] }],
  },
  courses: [{ name: "Math", day: 1, periods: ["C"], room: "101" }],
};
parser.parseScheduleImage = parser.createScheduleRecognizer({
  model: async () => {
    calls++;
    return recognize
      ? await recognize()
      : {
          content: JSON.stringify(fixture),
          model: "gpt-4o",
          inputTokens: 1,
          outputTokens: 1,
          latencyMs: 1,
        };
  },
  record: async () => {
    if (logFailure) throw new Error("injected logging failure");
  },
});
const parse = require("../app/api/parse-schedule/route.ts");
const usage = require("../app/api/user/usage/route.ts");
const jobs = require("../app/api/recognition/jobs/route.ts");
const exported = require("../app/api/export-ics/route.ts");
const { accountStore } = require("../lib/account-access.ts");
function image(id) {
  const data = new FormData();
  data.set(
    "image",
    new File(["pixels"], "schedule.png", { type: "image/png" }),
  );
  data.set("jobId", id);
  return new NextRequest("https://app.example/api/parse-schedule", {
    method: "POST",
    body: data,
  });
}
test("authenticated parse retries return saved courses without second call; account isolation and query cannot increment", async () => {
  try {
    session = null;
    assert.equal((await parse.POST(image("signed-out-job-01"))).status, 401);
    session = { user: { id: "route-user" } };
    const first = await parse.POST(image("successful-route-01"));
    assert.equal(first.status, 200);
    const result = await first.json();
    assert.equal(result.courses[0].name, "Math");
    assert.equal(result.usage.freeScansRemaining, 2);
    const again = await parse.POST(image("successful-route-01"));
    assert.equal(again.status, 200);
    assert.equal(calls, 1);
    assert.deepEqual((await again.json()).courses, result.courses);
    assert.equal(usage.POST, undefined);
    session = { user: { id: "other-user" } };
    assert.equal(
      (
        await (
          await jobs.GET(
            new NextRequest(
              "https://app.example/api/recognition/jobs?id=successful-route-01",
            ),
          )
        ).json()
      ).jobs.length,
      0,
    );
    session = { user: { id: "route-user" } };
    logFailure = true;
    assert.equal((await parse.POST(image("logging-failure-01"))).status, 500);
    logFailure = false;
    assert.equal((await (await usage.GET()).json()).freeScansRemaining, 2);
    const invalid = structuredClone(fixture);
    invalid.courses[0].periods = ["K"];
    recognize = async () => ({
      content: JSON.stringify(invalid),
      model: "gpt-4o",
      inputTokens: 4,
      outputTokens: 2,
      latencyMs: 1,
    });
    const rejected = await parse.POST(image("invalid-content-01"));
    assert.equal(rejected.status, 422);
    const rejection = await rejected.json();
    assert.equal(rejection.code, "unknown_period");
    assert.match(rejection.error, /Math/);
    assert.equal((await (await usage.GET()).json()).freeScansRemaining, 2);
    assert.equal(
      (
        await (
          await jobs.GET(
            new NextRequest(
              "https://app.example/api/recognition/jobs?id=invalid-content-01",
            ),
          )
        ).json()
      ).jobs[0].state,
      "failed",
    );
    recognize = async () => {
      throw new Error("private provider credentials");
    };
    const providerFailure = await parse.POST(image("provider-failure-01"));
    assert.equal(providerFailure.status, 502);
    assert(
      !JSON.stringify(await providerFailure.json()).includes(
        "private provider",
      ),
    );
    recognize = undefined;
    const blocked = await exported.POST(
      new NextRequest("https://app.example/api/export-ics", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ courses: result.courses }),
      }),
    );
    assert.equal(blocked.status, 402);
    await accountStore().grant("route-user", "verified-paid", 1);
    for (let i = 0; i < 3; i++)
      assert.equal(
        (await parse.POST(image("remaining-route-0" + i))).status,
        200,
      );
    const depleted = await usage.GET();
    const balance = await depleted.json();
    assert.equal(balance.remaining, 0);
    assert.equal(balance.canExportIcs, true);
    assert.equal((await parse.POST(image("insufficient-route-1"))).status, 402);
    const download = await exported.POST(
      new NextRequest("https://app.example/api/export-ics", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ courses: result.courses }),
      }),
    );
    assert.equal(download.status, 200);
    assert.match(await download.text(), /BEGIN:VCALENDAR/);
    for (const courses of [
      [],
      [{ name: "Empty", professor: "", slots: [] }],
      [
        ...result.courses,
        {
          name: "Broken",
          professor: "",
          slots: [
            {
              weekday: "Monday",
              startTime: "10:00",
              endTime: "09:00",
              location: "",
            },
          ],
        },
      ],
    ]) {
      const rejected = await exported.POST(
        new NextRequest("https://app.example/api/export-ics", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ courses }),
        }),
      );
      assert.equal(rejected.status, 400);
    }
    // All existing authenticated payload forms remain protected and complete.
    const packed = JSON.stringify({ courses: result.courses });
    const compatible = [
      () =>
        new NextRequest(
          "https://app.example/api/export-ics?d=" + encodeURIComponent(packed),
        ),
      () =>
        new NextRequest("https://app.example/api/export-ics", {
          method: "POST",
          headers: { "Content-Type": "application/x-www-form-urlencoded" },
          body: new URLSearchParams({ payload: packed }).toString(),
        }),
    ];
    for (const request of compatible) {
      const download =
        await exported[request().method === "GET" ? "GET" : "POST"](request());
      assert.equal(download.status, 200);
      assert.match(await download.text(), /BEGIN:VEVENT/);
    }
    session = null;
    for (const request of compatible)
      assert.equal(
        (await exported[request().method === "GET" ? "GET" : "POST"](request()))
          .status,
        401,
      );
  } finally {
    db.close();
  }
});
