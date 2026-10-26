/* eslint-disable @typescript-eslint/no-require-imports */
const { chromium, expect } = require("@playwright/test");
const assert = require("node:assert/strict");
const origin = process.env.CHECKOUT_TEST_ORIGIN || "http://127.0.0.1:2999";
const course = [
  {
    name: "Preserved edited course",
    professor: "Fixture",
    slots: [
      {
        weekday: "Monday",
        startTime: "09:00",
        endTime: "10:00",
        location: "Room",
      },
    ],
  },
];
(async () => {
  const browser = await chromium.launch();
  const context = await browser.newContext({
    locale: "zh-TW",
    viewport: { width: 1280, height: 900 },
  });
  let account = "alice",
    free = 3,
    credit = 0,
    unlocked = false,
    reads = 0,
    mode = "ok",
    held = [],
    holdReads = false,
    holdCoupon = false,
    releaseCoupon,
    failParse = false;
  let exportStatus = 503,
    exports = 0,
    holdSignIn = false;
  let releases = [],
    nextPayment = 0;
  const errors = [];
  context.on("page", (p) => p.on("pageerror", (e) => errors.push(e.message)));
  const data = () => ({
    userId: account,
    freeScansRemaining: free,
    gpt4oRemaining: credit,
    remaining: free + credit,
    canExportIcs: unlocked,
    paid: unlocked,
    stripeCheckoutEnabled: true,
  });
  await context.route("**/api/**", async (route) => {
    const req = route.request(),
      url = new URL(req.url());
    const json = (v) => route.fulfill({ json: v });
    if (url.pathname === "/api/auth/session")
      return json(
        account
          ? {
              user: {
                id: account,
                name: account,
                email: account + "@example.invalid",
              },
              expires: "2099-01-01T00:00:00Z",
            }
          : {},
      );
    if (url.pathname === "/api/auth/providers" && holdSignIn)
      return new Promise(() => {});
    if (url.pathname === "/api/export-ics") {
      exports++;
      return route.fulfill({
        status: exportStatus,
        json: { error: "Fixture export failure" },
      });
    }
    if (url.pathname === "/api/user/usage") {
      reads++;
      const captured = data(),
        capturedMode = mode;
      const respond = async () => {
        if (capturedMode === "error")
          await route.fulfill({ status: 503, json: {} });
        else if (capturedMode === "auth")
          await route.fulfill({ status: 401, json: {} });
        else
          await json(
            capturedMode === "invalid"
              ? { ...captured, remaining: -99 }
              : captured,
          );
      };
      if (holdReads)
        return new Promise((resolve) =>
          held.push(async () => {
            await respond();
            resolve();
          }),
        );
      return respond();
    }
    if (url.pathname === "/api/recognition/jobs") return json({ jobs: [] });
    if (url.pathname === "/api/account/reviews") return json({ reviews: [] });
    if (url.pathname === "/api/coupon/redeem") {
      const respond = async () => {
        credit += 10;
        unlocked = true;
        await json({ ...data(), redeemed: true });
      };
      if (holdCoupon)
        return new Promise((resolve) => {
          releaseCoupon = async () => {
            await respond();
            resolve();
          };
        });
      return respond();
    }
    if (url.pathname === "/api/parse-schedule")
      return new Promise((resolve) =>
        releases.push(async () => {
          if (failParse)
            await route.fulfill({
              status: 422,
              json: { error: "Fixture recognition failed" },
            });
          else {
            free = Math.max(0, free - 1);
            await json({ courses: course, usage: data() });
          }
          resolve();
        }),
      );
    if (url.pathname === "/api/checkout/ecpay")
      return route.fulfill({
        headers: {
          "content-type": "text/html",
          "x-cc-payment-id": "CC" + ++nextPayment,
        },
        body: `<script>location.href='/?ecpay_order=CC${nextPayment}'</script>`,
      });
    if (url.pathname === "/api/checkout/ecpay/status") {
      credit += 30;
      unlocked = true;
      return json({ ...data(), paymentStatus: "paid" });
    }
    return route.fulfill({
      status: 404,
      json: { error: "Unmocked API - never forwarded" },
    });
  });
  const page = await context.newPage();
  async function settled() {
    await page.getByText("最近辨識（7 天內）", { exact: true }).waitFor();
  }
  async function both(p = page) {
    await expect(p.getByLabel("帳號權益摘要")).toContainText(
      `共 ${free + credit} 次`,
    );
    await expect(
      p
        .locator("header")
        .getByRole("button", {
          name: unlocked
            ? `剩餘解析：${free + credit} 次`
            : `剩餘免費掃描：${free + credit} 次`,
          exact: true,
        })
        .last(),
    ).toBeVisible();
  }
  async function coupon(p = page) {
    await p.evaluate(() => window.dispatchEvent(new Event("cc-open-paywall")));
    const dialog = p.getByRole("dialog");
    await dialog.getByRole("button", { name: /有優惠碼/ }).click();
    await dialog.getByRole("textbox").fill("fixture");
    await dialog.getByRole("button", { name: "兌換", exact: true }).click();
  }
  async function upload() {
    const png = await page.evaluate(() => {
      const c = document.createElement("canvas");
      c.width = 800;
      c.height = 600;
      return c.toDataURL("image/png").split(",")[1];
    });
    await page.locator("input[type=file]").setInputFiles({
      name: "fixture.png",
      mimeType: "image/png",
      buffer: Buffer.from(png, "base64"),
    });
    await page
      .getByRole("button", { name: "直接使用全圖", exact: true })
      .click();
    await expect.poll(() => releases.length).toBeGreaterThan(0);
  }
  try {
    await page.goto(origin);
    await settled();
    await both();
    assert.equal(reads, 1, "two readers share one initial query");
    // Seed only a checkout draft: no entitlement snapshot is placed into storage.
    await page.evaluate((courses) => {
      const id = crypto.randomUUID(),
        savedAt = Date.now();
      localStorage.setItem(
        "cc_checkout_v1:alice:" + id,
        JSON.stringify({
          version: 1,
          id,
          accountId: "alice",
          provider: "ecpay",
          savedAt,
          expiresAt: savedAt + 7 * 86400000,
          courses,
        }),
      );
    }, course);
    await page.reload();
    await settled();
    await page
      .getByRole("button", { name: "恢復付款前課表", exact: true })
      .click();
    await page.getByText(course[0].name, { exact: true }).first().waitFor();
    // Hold an older foreground query, then redeem. Its late response cannot roll back either reader.
    holdReads = true;
    await page.evaluate(() => window.dispatchEvent(new Event("focus")));
    await expect.poll(() => held.length).toBe(1);
    await coupon();
    await both();
    await held.shift()();
    holdReads = false;
    await both();
    // Query failure retains a snapshot; retry recovers and editing stays open.
    await page.getByText(course[0].name, { exact: true }).first().click();
    mode = "error";
    await page.evaluate(() => window.dispatchEvent(new Event("focus")));
    await page
      .getByText("更新失敗，目前顯示上次確認結果", { exact: true })
      .waitFor();
    await expect(page.getByRole("dialog")).toBeVisible();
    await both();
    await page
      .getByRole("dialog")
      .getByRole("button", { name: "完成", exact: true })
      .click();
    mode = "ok";
    await page
      .getByRole("button", { name: "重新查詢權益", exact: true })
      .click();
    await expect(page.getByLabel("帳號權益狀態", { exact: true })).toHaveCount(
      0,
    );
    await both();
    // Invalid response must be rejected as a whole.
    mode = "invalid";
    await page.evaluate(() => window.dispatchEvent(new Event("focus")));
    await page
      .getByText("更新失敗，目前顯示上次確認結果", { exact: true })
      .waitFor();
    await both();
    mode = "ok";
    await page
      .getByRole("button", { name: "重新查詢權益", exact: true })
      .click();
    await expect(page.getByLabel("帳號權益狀態", { exact: true })).toHaveCount(
      0,
    );
    // Query during which another tab changes benefits gets a follow-up, not a parallel read.
    const second = await context.newPage();
    await second.goto(origin);
    await second.getByLabel("帳號權益摘要").waitFor();
    await page.bringToFront();
    await expect(page.getByLabel("帳號權益狀態", { exact: true })).toHaveCount(
      0,
    );
    holdReads = true;
    await page.evaluate(() => window.dispatchEvent(new Event("focus")));
    await expect.poll(() => held.length).toBe(1);
    const beforeChange = reads;
    await coupon(second);
    await expect.poll(() => credit).toBe(20);
    assert.equal(reads, beforeChange);
    await held.shift()();
    await expect.poll(() => held.length).toBe(1);
    await held.shift()();
    holdReads = false;
    await both();
    await both(second);
    await second.close();
    // Concurrent recognition and redemption converge after both operations finish.
    holdCoupon = true;
    await coupon();
    await expect.poll(() => typeof releaseCoupon).toBe("function");
    await page.keyboard.press("Escape");
    // Close paywall without mutating its operation; recognition can run concurrently.
    await page.evaluate(() => document.getElementById("upload").click());
    await upload();
    await releaseCoupon();
    holdCoupon = false;
    await releases.shift()();
    await both();
    // Failed recognition also terminates its operation and preserves usable entitlement display.
    failParse = true;
    await upload();
    await releases.shift()();
    failParse = false;
    await both();
    // Payment return updates both readers using a simulated gateway.
    await page.evaluate(() =>
      window.dispatchEvent(new Event("cc-open-paywall")),
    );
    await Promise.all([
      page.waitForURL((u) => u.searchParams.has("ecpay_order")),
      page
        .getByRole("dialog")
        .getByRole("button", { name: /綠界|ECPay/ })
        .click(),
    ]);
    await page
      .getByText("付款已確認，帳號權益已更新。", { exact: true })
      .waitFor();
    await both();
    // Auth expiry removes numbers without touching loaded courses; old replies cannot revive them.
    await page
      .getByRole("button", { name: "恢復付款前課表", exact: true })
      .first()
      .click();
    mode = "auth";
    await page.evaluate(() => window.dispatchEvent(new Event("focus")));
    await page.getByRole("button", { name: "登入", exact: true }).waitFor();
    assert.equal(await page.getByLabel("帳號權益摘要").count(), 0);
    await page.getByText(course[0].name, { exact: true }).first().waitFor();
    mode = "ok";
    await page.reload();
    await settled();
    await both();
    // Export's own 401 clears shared benefits before the sign-in redirect proceeds.
    await page
      .getByRole("button", { name: "恢復付款前課表", exact: true })
      .first()
      .click();
    exportStatus = 401;
    holdSignIn = true;
    await page
      .getByRole("button", { name: "下載 .ics 行事曆", exact: true })
      .click();
    await page.getByRole("button", { name: "登入", exact: true }).waitFor();
    assert.equal(await page.getByLabel("帳號權益摘要").count(), 0);
    await page.getByText(course[0].name, { exact: true }).first().waitFor();
    await page.reload();
    holdSignIn = false;
    exportStatus = 503;
    await settled();
    await both();
    // Current account is cleared immediately; another account's delayed query is ignored.
    holdReads = true;
    await page.evaluate(() => window.dispatchEvent(new Event("focus")));
    await expect.poll(() => held.length).toBe(1);
    account = "bob";
    free = 1;
    credit = 0;
    unlocked = false;
    holdReads = false;
    await page.evaluate(() =>
      document.dispatchEvent(new Event("visibilitychange")),
    );
    await both();
    await held.shift()();
    await both();
    // Initial failure never presents fake zero credits.
    mode = "error";
    await page.reload();
    await settled();
    await page.getByText("暫時無法確認權益", { exact: true }).waitFor();
    assert.equal(await page.getByLabel("帳號權益摘要").count(), 0);
    await page.evaluate((courses) => {
      const id = crypto.randomUUID(),
        savedAt = Date.now();
      localStorage.setItem(
        "cc_checkout_v1:bob:" + id,
        JSON.stringify({
          version: 1,
          id,
          accountId: "bob",
          provider: "ecpay",
          savedAt,
          expiresAt: savedAt + 7 * 86400000,
          courses,
        }),
      );
    }, course);
    await page.reload();
    await settled();
    await page
      .getByRole("button", { name: "恢復付款前課表", exact: true })
      .first()
      .click();
    const beforeExport = exports;
    await page.getByRole("button", { name: /確認資格並下載/ }).click();
    await expect.poll(() => exports).toBe(beforeExport + 1);
    assert.equal(
      await page.getByRole("dialog").count(),
      0,
      "unknown benefits must not open a payment prompt",
    );
    mode = "ok";
    await page
      .getByRole("button", { name: "重新查詢權益", exact: true })
      .click();
    await expect(page.getByLabel("帳號權益狀態", { exact: true })).toHaveCount(
      0,
    );
    await both();
    assert.equal(
      await page
        .getByRole("button", {
          name: /切換為已付費|重設為未付費|次數充值|次數歸零/,
        })
        .count(),
      0,
    );
    await page.getByText("切換幣別預覽", { exact: false }).first().waitFor();
    assert.deepEqual(errors, []);
    console.log(
      "PASS: shared readers; old responses; payment, recognition and coupon; overlap convergence; cross-tab invalidation/follow-up; foreground; invalid data; failures/retry; auth isolation; editing preserved; dev preview disabled. Page errors:0. All APIs intercepted.",
    );
  } finally {
    await browser.close();
  }
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
