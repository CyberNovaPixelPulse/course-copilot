/* eslint-disable @typescript-eslint/no-require-imports */
const { chromium, expect } = require("@playwright/test"),
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
const { coursesToIcs } = require("../../lib/ics.ts");
const origin = process.env.CHECKOUT_TEST_ORIGIN || "http://127.0.0.1:2999";
(async () => {
  const browser = await chromium.launch();
  const context = await browser.newContext({
    locale: "zh-TW",
    viewport: { width: 1280, height: 1000 },
    acceptDownloads: true,
  });
  let account = "alice",
    exports = [],
    modes = [],
    held = [];
  const errors = [];
  await context.addInitScript(() => {
    const toBlob = HTMLCanvasElement.prototype.toBlob,
      create = URL.createObjectURL;
    HTMLCanvasElement.prototype.toBlob = function (callback, ...args) {
      if (window.__failCard) {
        window.__failCard = false;
        callback(null);
        return;
      }
      return toBlob.call(this, callback, ...args);
    };
    URL.createObjectURL = function (blob) {
      if (window.__failDownload && blob.type.startsWith("text/calendar")) {
        window.__failDownload = false;
        throw new Error("fixture download failure");
      }
      return create.call(this, blob);
    };
    window.__drawnText = [];
    const fill = CanvasRenderingContext2D.prototype.fillText;
    CanvasRenderingContext2D.prototype.fillText = function (text, ...args) {
      window.__drawnText.push(text);
      return fill.call(this, text, ...args);
    };
  });
  context.on("page", (p) => p.on("pageerror", (e) => errors.push(e.message)));
  await context.route("**/api/**", async (route) => {
    const url = new URL(route.request().url());
    if (url.pathname === "/api/auth/session")
      return route.fulfill({
        json: account
          ? {
              user: {
                id: account,
                name: account,
                email: account + "@example.invalid",
              },
              expires: "2099-01-01T00:00:00Z",
            }
          : {},
      });
    if (url.pathname === "/api/user/usage")
      return route.fulfill({
        json: {
          userId: account,
          freeScansRemaining: 0,
          gpt4oRemaining: 0,
          remaining: 0,
          paid: true,
          canExportIcs: true,
          stripeCheckoutEnabled: true,
        },
      });
    if (url.pathname === "/api/account/reviews")
      return route.fulfill({ json: { reviews: [] } });
    if (url.pathname === "/api/recognition/jobs")
      return route.fulfill({ json: { jobs: [] } });
    if (url.pathname === "/api/export-ics") {
      const courses = route.request().postDataJSON().courses;
      exports.push(courses);
      const mode = modes.shift() || "success";
      const respond = () =>
        route
          .fulfill({
            contentType:
              mode === "html" ? "text/html" : "text/calendar; charset=utf-8",
            body:
              mode === "html" ? "<html>error</html>" : coursesToIcs(courses),
          })
          .catch(() => {});
      if (mode === "hold")
        return new Promise((resolve) =>
          held.push(async () => {
            await respond();
            resolve();
          }),
        );
      if (mode === "payment")
        return route.fulfill({ status: 402, json: { error: "payment" } });
      return respond();
    }
    return route.fulfill({ status: 404, json: { error: "Not forwarded" } });
  });
  const page = await context.newPage(),
    downloads = [];
  page.on("download", (d) => downloads.push(d));
  const status = () =>
    page.getByRole("region", { name: "行事曆匯出", exact: true });
  const result = () =>
    page.getByRole("dialog", { name: "行事曆檔案已準備好", exact: true });
  const headerDownload = () =>
    page
      .getByRole("button", { name: /下載.*ics|下載行事曆/i })
      .filter({ hasText: /下載/ })
      .first();
  async function add(name) {
    await page.getByRole("button", { name: /新增課程/ }).click();
    const d = page.getByRole("dialog");
    await d.getByLabel("課程名稱", { exact: true }).fill(name);
    await d.getByRole("button", { name: "確認新增", exact: true }).click();
  }
  async function close() {
    await result().getByRole("button").last().click();
  }
  async function count(n) {
    await expect.poll(() => downloads.length).toBe(n);
  }
  try {
    await page.goto(origin + "/#upload");
    await add("Export A");
    modes.push("hold");
    await headerDownload().click();
    await headerDownload().click();
    await expect.poll(() => exports.length).toBe(1);
    await add("Export B");
    await expect(status()).toContainText("先前的課表版本");
    await page.evaluate(() => {
      window.__failCard = true;
    });
    await held.shift()();
    await count(1);
    await expect(result()).toBeVisible();
    await expect(result()).toContainText("先前的課表版本");
    const text = fs.readFileSync(await downloads[0].path(), "utf8");
    assert.match(text, /SUMMARY:Export A/);
    assert.doesNotMatch(text, /Export B/);
    await expect(
      result().getByRole("button", { name: "重試產生圖片", exact: true }),
    ).toBeVisible();
    await result()
      .getByRole("button", { name: "重試產生圖片", exact: true })
      .click();
    await expect(result().locator("img")).toBeVisible({ timeout: 20000 });
    assert.equal(exports.length, 1);
    const drawn = await page.evaluate(() => window.__drawnText.join("\n"));
    assert.match(drawn, /Export A/);
    assert.doesNotMatch(drawn, /Export B/);
    await expect(
      result().getByRole("button", { name: "交付至 Apple 日曆", exact: true }),
    ).toHaveCount(0);
    await close();
    await status()
      .getByRole("button", { name: "查看這次匯出結果", exact: true })
      .click();
    assert.equal(downloads.length, 1);
    assert.equal(exports.length, 1);
    await result()
      .getByRole("button", { name: "下載 ICS 檔案", exact: true })
      .click();
    await count(2);
    assert.equal(fs.readFileSync(await downloads[1].path(), "utf8"), text);
    assert.equal(exports.length, 1);
    await close();
    modes.push("hold");
    await status()
      .getByRole("button", { name: "改用目前課表重新匯出", exact: true })
      .click();
    await expect.poll(() => exports.length).toBe(2);
    await add("Export C");
    await status()
      .getByRole("button", { name: "改用目前課表重新匯出", exact: true })
      .click();
    await count(3);
    await held.shift()();
    await expect(result()).toBeVisible();
    assert.equal(exports.length, 3);
    assert.equal(downloads.length, 3);
    await close();
    modes.push("html");
    await status()
      .getByRole("button", { name: "改用目前課表重新匯出", exact: true })
      .click();
    await expect(status().getByRole("alert")).toBeVisible();
    assert.equal(downloads.length, 3);
    await status()
      .getByRole("button", { name: "重試準備", exact: true })
      .click();
    await count(4);
    assert.deepEqual(exports[3], exports[4]);
    await close();
    await page.evaluate(() => {
      window.__failDownload = true;
    });
    await status()
      .getByRole("button", { name: "改用目前課表重新匯出", exact: true })
      .click();
    await expect(result().getByRole("alert")).toBeVisible();
    assert.equal(downloads.length, 4);
    const before = exports.length;
    await result()
      .getByRole("button", { name: "下載 ICS 檔案", exact: true })
      .click();
    await count(5);
    assert.equal(exports.length, before);
    await page.screenshot({
      path: "/tmp/calendar-export-desktop.png",
      fullPage: true,
    });
    await close();
    modes.push("hold");
    await status()
      .getByRole("button", { name: "改用目前課表重新匯出", exact: true })
      .click();
    await expect.poll(() => held.length).toBe(1);
    account = "bob";
    await page.evaluate(() =>
      document.dispatchEvent(new Event("visibilitychange")),
    );
    await expect(status()).toHaveCount(0);
    await held.shift()();
    assert.equal(downloads.length, 5);
    await expect(result()).toHaveCount(0);
    await page.clock.install();
    await add("Bob");
    modes.push("hold");
    await headerDownload().click();
    await expect.poll(() => held.length).toBe(1);
    await page.clock.fastForward(30001);
    await expect(status()).toContainText("三十秒");
    await held.shift()();
    assert.equal(downloads.length, 5);
    await status()
      .getByRole("button", { name: "重試準備", exact: true })
      .click();
    await count(6);
    await close();
    await page.evaluate(() =>
      Object.defineProperty(navigator, "userAgent", {
        value: "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X)",
        configurable: true,
      }),
    );
    await status()
      .getByRole("button", { name: "查看這次匯出結果", exact: true })
      .click();
    await expect(
      result().getByRole("button", { name: "交付至 Apple 日曆", exact: true }),
    ).toBeVisible();
    await expect(result()).toContainText("尚未完成真機驗收");
    await page.setViewportSize({ width: 390, height: 844 });
    await page.screenshot({
      path: "/tmp/calendar-export-mobile.png",
      fullPage: true,
    });
    await page.evaluate(() =>
      Object.defineProperty(navigator, "userAgent", {
        value: "Desktop",
        configurable: true,
      }),
    );
    await result()
      .getByRole("button", { name: "交付至 Apple 日曆", exact: true })
      .click();
    await expect(result().getByRole("alert")).toContainText("無法觸發交付");
    assert.equal(downloads.length, 6);
    const requestCount = exports.length;
    await result()
      .getByRole("button", { name: "下載 ICS 檔案", exact: true })
      .click();
    await count(7);
    assert.equal(exports.length, requestCount);
    await close();
    await page.reload();
    await expect(status()).toHaveCount(0);
    await add("Leave fixture");
    modes.push("hold");
    await headerDownload().click();
    await expect.poll(() => held.length).toBe(1);
    const beforeLeave = downloads.length;
    await page.evaluate(() =>
      window.dispatchEvent(
        new PageTransitionEvent("pagehide", { persisted: true }),
      ),
    );
    await expect(status()).toHaveCount(0);
    await held.shift()();
    assert.equal(downloads.length, beforeLeave);
    await expect(result()).toHaveCount(0);
    await page.evaluate(() =>
      window.dispatchEvent(
        new PageTransitionEvent("pageshow", { persisted: true }),
      ),
    );
    await headerDownload().click();
    await count(beforeLeave + 1);
    await close();
    modes.push("hold");
    await status()
      .getByRole("button", { name: "改用目前課表重新匯出", exact: true })
      .click();
    await expect.poll(() => held.length).toBe(1);
    account = null;
    await page.evaluate(() =>
      document.dispatchEvent(new Event("visibilitychange")),
    );
    await expect(
      page.getByRole("button", { name: "登入", exact: true }).first(),
    ).toBeVisible();
    await expect(status()).toHaveCount(0);
    await held.shift()();
    assert.equal(downloads.length, beforeLeave + 1);
    await expect(result()).toHaveCount(0);
    assert.deepEqual(errors, []);
    console.log(
      "PASS calendar export: fixed snapshot/image, duplicate clicks, replacement, stale account, timeout/retry, invalid response, delivery failure, reopen and exact redownload. Page errors:0. All APIs intercepted; no real model/payment.",
    );
  } finally {
    await browser.close();
  }
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
