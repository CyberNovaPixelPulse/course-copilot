/* eslint-disable @typescript-eslint/no-require-imports */
const { chromium, expect } = require("@playwright/test");
const assert = require("node:assert/strict");
const origin = process.env.CHECKOUT_TEST_ORIGIN || "http://127.0.0.1:2999";
const course = (name) => ({
  name,
  professor: "Fixture",
  slots: [
    {
      weekday: "Monday",
      startTime: "09:00",
      endTime: "10:00",
      location: "101",
    },
  ],
});
(async () => {
  const browser = await chromium.launch();
  const context = await browser.newContext({
    locale: "zh-TW",
    viewport: { width: 1280, height: 900 },
  });
  let account = "alice",
    free = 10,
    posts = [],
    outcomes = [],
    checks = 0,
    hold = false,
    finishHeld,
    queryAuth = false;
  const jobs = new Map(),
    errors = [];
  context.on("page", (page) =>
    page.on("pageerror", (e) => errors.push(e.message)),
  );
  const usage = () => ({
    userId: account,
    freeScansRemaining: free,
    gpt4oRemaining: 0,
    remaining: free,
    canExportIcs: false,
    paid: false,
    stripeCheckoutEnabled: false,
  });
  await context.route("**/api/**", async (route) => {
    const req = route.request(),
      url = new URL(req.url()),
      json = (v) => route.fulfill({ json: v });
    if (url.pathname === "/api/auth/session")
      return json({
        user: {
          id: account,
          name: account,
          email: account + "@example.invalid",
        },
        expires: "2099-01-01T00:00:00Z",
      });
    if (url.pathname === "/api/user/usage") return json(usage());
    if (url.pathname === "/api/account/reviews") return json({ reviews: [] });
    if (url.pathname === "/api/recognition/jobs") {
      const id = url.searchParams.get("id");
      if (id) {
        checks++;
        if (queryAuth) return route.fulfill({ status: 401, json: {} });
        return json({ jobs: jobs.has(id) ? [{ id, ...jobs.get(id) }] : [] });
      }
      return json({
        jobs: [...jobs].map(([id, j]) => ({ id, ...j, createdAt: Date.now() })),
      });
    }
    if (url.pathname === "/api/parse-schedule") {
      const body = req.postDataBuffer().toString();
      const id = body.match(/name="jobId"\r\n\r\n([^\r]+)/)[1];
      posts.push(id);
      const mode = outcomes.shift() || "success";
      const respond = async () => {
        if (mode === "fail") {
          jobs.set(id, { state: "failed", courses: null });
          return route.fulfill({
            status: 422,
            json: { code: "unsupported_period", error: "Fixture rejected" },
          });
        }
        if (mode === "network") {
          jobs.set(id, { state: "running", courses: null });
          return route.abort("failed");
        }
        free--;
        const result = {
          state: "succeeded",
          courses: [course("Result " + posts.length)],
        };
        jobs.set(id, result);
        return json({ ...result, jobId: id, usage: usage() });
      };
      if (hold)
        return new Promise((resolve) => {
          finishHeld = async () => {
            await respond();
            resolve();
          };
        });
      return respond();
    }
    return route.fulfill({
      status: 404,
      json: { error: "Not mocked; never forwarded" },
    });
  });
  const page = await context.newPage();
  const batch = () =>
    page.getByRole("region", { name: "辨識批次", exact: true });
  async function ready() {
    await page.getByText("最近辨識（7 天內）", { exact: true }).waitFor();
  }
  async function fixture(name, color) {
    const base64 = await page.evaluate((color) => {
      const c = document.createElement("canvas");
      c.width = 300;
      c.height = 200;
      const x = c.getContext("2d");
      x.fillStyle = color;
      x.fillRect(0, 0, 300, 200);
      return c.toDataURL("image/png").split(",")[1];
    }, color);
    return {
      name,
      mimeType: "image/png",
      buffer: Buffer.from(base64, "base64"),
    };
  }
  async function select(files) {
    await page.locator("input[type=file]").setInputFiles(files);
  }
  async function prepareAll(n) {
    for (let i = 0; i < n; i++)
      await page
        .getByRole("button", { name: "直接使用全圖", exact: true })
        .click();
  }
  async function end() {
    page.once("dialog", (d) => d.accept());
    await batch()
      .getByRole("button", { name: "結束這批", exact: true })
      .click();
  }
  async function load(overwrite = true) {
    if (overwrite) page.once("dialog", (d) => d.accept());
    await batch()
      .getByRole("button", { name: "載入本批次成功結果", exact: true })
      .click();
  }
  try {
    await page.goto(origin);
    await ready();
    await page.getByRole("button", { name: /範例/ }).click();
    const beforeText = await page.locator("#upload").innerText();
    outcomes = ["success", "fail", "success"];
    await select([
      await fixture("one.png", "red"),
      await fixture("two.png", "blue"),
      await fixture("three.png", "green"),
    ]);
    await prepareAll(3);
    await expect(batch()).toContainText("two.png — 失敗");
    assert.equal(posts.length, 2);
    await expect(batch()).toContainText("three.png — 未送出");
    await expect(batch()).toContainText("部分成功");
    assert.ok(beforeText.includes("課表"));
    assert.equal(await page.getByText("Result 1", { exact: true }).count(), 0);
    // Decline overwriting, then explicitly load the partial result.
    page.once("dialog", (d) => d.dismiss());
    await batch()
      .getByRole("button", { name: "載入本批次成功結果", exact: true })
      .click();
    assert.equal(await page.getByText("Result 1", { exact: true }).count(), 0);
    await load();
    await page.getByText("Result 1", { exact: true }).first().waitFor();
    await batch()
      .getByRole("button", { name: "重試這張", exact: true })
      .click();
    await expect(batch()).toContainText("two.png — 成功");
    assert.equal(posts.length, 3);
    assert.notEqual(posts[1], posts[2]);
    await batch()
      .getByRole("button", { name: "繼續剩餘圖片", exact: true })
      .click();
    await expect(batch()).toContainText("three.png — 成功");
    assert.equal(posts.length, 4);
    await load();
    await page.getByText("Result 4", { exact: true }).first().waitFor();
    // New pending batch cannot absorb dropped/selected files; query original without a second POST.
    await end();
    outcomes = ["network"];
    await select([
      await fixture("uncertain.png", "purple"),
      await fixture("later.png", "orange"),
    ]);
    await prepareAll(2);
    await expect(batch()).toContainText("uncertain.png — 尚待確認");
    const original = posts.at(-1),
      postCount = posts.length;
    assert.equal(checks, 1);
    await select([await fixture("not-added.png", "black")]);
    await page
      .getByText("請先完成或結束目前辨識批次，新圖片尚未加入。", {
        exact: true,
      })
      .waitFor();
    await expect(batch()).not.toContainText("not-added.png");
    queryAuth = true;
    await batch()
      .getByRole("button", { name: "重新查詢原工作", exact: true })
      .click();
    await expect(batch()).toContainText("uncertain.png — 尚待確認");
    await page.getByRole("button", { name: "登入", exact: true }).waitFor();
    queryAuth = false;
    await page.reload();
    await ready();
    await select([
      await fixture("uncertain.png", "purple"),
      await fixture("later.png", "orange"),
    ]);
    await prepareAll(2);
    await expect(batch()).toContainText("uncertain.png — 尚待確認");
    assert.equal(
      posts.length,
      postCount,
      "lookup 401 must retain the original reference after reload",
    );
    jobs.set(original, {
      state: "succeeded",
      courses: [course("Recovered original")],
    });
    await batch()
      .getByRole("button", { name: "重新查詢原工作", exact: true })
      .click();
    await expect(batch()).toContainText("uncertain.png — 成功");
    assert.equal(posts.length, postCount);
    await expect(batch()).toContainText("later.png — 未送出");
    await end();
    // Compression failure is visible inside crop dialog and requires explicit skip.
    await page.evaluate(() => {
      const original = HTMLCanvasElement.prototype.toBlob;
      let fail = true;
      HTMLCanvasElement.prototype.toBlob = function (callback, ...args) {
        if (fail) {
          fail = false;
          callback(null);
        } else original.call(this, callback, ...args);
      };
    });
    await select([
      await fixture("bad-prepare.png", "cyan"),
      await fixture("prepared.png", "yellow"),
    ]);
    await page
      .getByRole("button", { name: "直接使用全圖", exact: true })
      .click();
    await page
      .getByRole("dialog")
      .getByText(/圖片準備失敗/)
      .waitFor();
    assert.equal(posts.length, postCount);
    await page
      .getByRole("button", { name: "略過這張圖片", exact: true })
      .click();
    await prepareAll(1);
    await expect(batch()).toContainText("prepared.png — 成功");
    assert.equal(posts.length, postCount + 1);
    await end();
    // Local storage failure is not bypassed; retry sends once after storage recovers.
    await page.evaluate(() => {
      window.fixtureSetItem = Storage.prototype.setItem;
      Storage.prototype.setItem = function (k, v) {
        if (k.startsWith("cc_pending_job:")) throw new DOMException("quota");
        return window.fixtureSetItem.call(this, k, v);
      };
    });
    const beforeStorage = posts.length;
    await select([await fixture("storage.png", "gray")]);
    await prepareAll(1);
    await expect(batch()).toContainText("線索保存失敗，尚未送出");
    assert.equal(posts.length, beforeStorage);
    await page.evaluate(() => {
      Storage.prototype.setItem = window.fixtureSetItem;
    });
    await batch()
      .getByRole("button", { name: "重試這張", exact: true })
      .click();
    await expect(batch()).toContainText("storage.png — 成功");
    assert.equal(posts.length, beforeStorage + 1);
    await end();
    // A late completed result updates candidate/credits without replacing a sample or restored schedule.
    hold = true;
    await select([await fixture("late.png", "pink")]);
    await prepareAll(1);
    await expect.poll(() => typeof finishHeld).toBe("function");
    await page.getByRole("button", { name: /範例/ }).click();
    await finishHeld();
    hold = false;
    await expect(batch()).toContainText("late.png — 成功");
    assert.equal(
      await page.getByText("Result " + posts.length, { exact: true }).count(),
      0,
    );
    await expect(page.getByLabel("帳號權益摘要")).toContainText(
      `共 ${free} 次`,
    );
    // Persisted pending reference survives reload, but prepared image bytes must be selected again.
    await end();
    outcomes = ["network"];
    const pendingImage = await fixture("reload.png", "white");
    await select([pendingImage]);
    await prepareAll(1);
    await expect(batch()).toContainText("尚待確認");
    const beforeReload = posts.length,
      id = posts.at(-1);
    await page.reload();
    await ready();
    jobs.set(id, { state: "succeeded", courses: [course("After reload")] });
    await select([pendingImage]);
    await prepareAll(1);
    await expect(batch()).toContainText("reload.png — 成功");
    assert.equal(posts.length, beforeReload);
    await load(false);
    await page.getByText("After reload", { exact: true }).first().waitFor();
    // Recent recognition remains the result recovery entry after the whole browser batch is gone.
    await page.reload();
    await ready();
    await page.getByText("最近辨識（7 天內）", { exact: true }).click();
    page.once("dialog", (d) => d.accept());
    await page
      .getByRole("button", { name: "恢復課程", exact: true })
      .last()
      .click();
    await page.getByText("After reload", { exact: true }).first().waitFor();
    assert.deepEqual(errors, []);
    console.log(
      "PASS: partial results, pause/retry/continue, explicit load/overwrite, unknown original-job lookup, single batch, preparation failure/skip, storage failure/retry, late results and credits, reload/reference/recent recovery. Page errors:0. No real model/payment.",
    );
  } finally {
    await browser.close();
  }
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
