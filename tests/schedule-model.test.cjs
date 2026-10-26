/* eslint-disable @typescript-eslint/no-require-imports */
// Local HTTP contract test: no image understanding or real provider is exercised.
const { test } = require("node:test"),
  assert = require("node:assert/strict"),
  http = require("node:http"),
  fs = require("node:fs"),
  path = require("node:path"),
  Module = require("node:module"),
  ts = require("typescript");
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
const { createScheduleRecognizer } = require("../lib/parse-schedule.ts"),
  { readScheduleModel } = require("../lib/schedule-model.ts");
test("production adapter preserves one image, strict schema and settings through the recognizer interface", async () => {
  const requests = [],
    records = [];
  const fixture = {
    scratchpad: {
      columns: [
        { column: 1, occupancy: "Empty Column" },
        { column: 2, occupancy: "Has Courses" },
        { column: 3, occupancy: "Empty Column" },
        { column: 4, occupancy: "Has Courses" },
        { column: 5, occupancy: "Empty Column" },
      ],
      cells: [
        { name: "都市研究", column: 2, codes: ["10"] },
        { name: "都市研究", column: 2, codes: ["11"] },
        { name: "影像與文化書寫（一）", column: 4, codes: ["13"] },
      ],
    },
    courses: [
      { name: "都市研究", day: 2, periods: ["10"], room: "" },
      { name: "都市研究", day: 2, periods: ["11"], room: "" },
      { name: "影像與文化書寫（一）", day: 4, periods: ["13"], room: "" },
    ],
  };
  const server = http.createServer(async (req, res) => {
    let body = "";
    for await (const chunk of req) body += chunk;
    requests.push({ url: req.url, body: JSON.parse(body) });
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(
      JSON.stringify({
        id: "local-fixture",
        object: "chat.completion",
        created: 1,
        model: "gpt-4o-fixture",
        choices: [
          {
            index: 0,
            message: { role: "assistant", content: JSON.stringify(fixture) },
            finish_reason: "stop",
          },
        ],
        usage: { prompt_tokens: 8, completion_tokens: 2, total_tokens: 10 },
      }),
    );
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const previous = {
    key: process.env.OPENAI_API_KEY,
    base: process.env.OPENAI_BASE_URL,
  };
  process.env.OPENAI_API_KEY = "local-test-only";
  process.env.OPENAI_BASE_URL = `http://127.0.0.1:${server.address().port}/v1`;
  try {
    const recognize = createScheduleRecognizer({
      model: readScheduleModel,
      record: async (r) => records.push(r),
    });
    const courses = await recognize(
      { mimeType: "image/png", base64: "bG9jYWwtZml4dHVyZQ==" },
      { accountId: "fixture", jobId: "fixture-job", creditBucket: "fixture" },
    );
    assert.deepEqual(courses, [
      {
        name: "都市研究",
        professor: "",
        slots: [
          {
            weekday: "Tuesday",
            startTime: "16:10",
            endTime: "18:00",
            location: "",
          },
        ],
      },
      {
        name: "影像與文化書寫（一）",
        professor: "",
        slots: [
          {
            weekday: "Thursday",
            startTime: "19:10",
            endTime: "20:00",
            location: "",
          },
        ],
      },
    ]);
    assert.equal(requests.length, 1);
    assert.equal(requests[0].url, "/v1/chat/completions");
    const body = requests[0].body;
    assert.equal(body.model, "gpt-4o");
    assert.equal(body.temperature, 0);
    assert.equal(body.top_p, 1e-6);
    assert.equal(body.seed, 42);
    assert.equal(body.response_format.type, "json_schema");
    assert.equal(body.response_format.json_schema.strict, true);
    assert.equal(
      body.response_format.json_schema.schema.properties.scratchpad.properties
        .columns.minItems,
      5,
    );
    assert.deepEqual(body.messages[1].content[1], {
      type: "image_url",
      image_url: {
        url: "data:image/png;base64,bG9jYWwtZml4dHVyZQ==",
        detail: "high",
      },
    });
    assert.equal(records[0].courseCount, 2);
    assert.equal(records[0].eventCount, 2);
    assert.equal(records[0].normalizationStatus, "succeeded");
    assert.equal(records[0].inputTokens, 8);
    assert.equal(records[0].outputTokens, 2);
  } finally {
    for (const [key, value] of [
      ["OPENAI_API_KEY", previous.key],
      ["OPENAI_BASE_URL", previous.base],
    ]) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    await new Promise((resolve) => server.close(resolve));
  }
});
