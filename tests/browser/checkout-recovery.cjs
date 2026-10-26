/* eslint-disable @typescript-eslint/no-require-imports */
// Run against a local Next server; every application API request is intercepted.
const { chromium } = require("@playwright/test");
const assert = require("node:assert/strict");
const origin = process.env.CHECKOUT_TEST_ORIGIN || "http://127.0.0.1:2999";
const edited = [
  {
    name: "Checkout edited mathematics",
    professor: "Fixture teacher",
    slots: [
      {
        weekday: "Monday",
        startTime: "08:10",
        endTime: "10:00",
        location: "Edited room",
      },
    ],
  },
];
(async () => {
  const browser = await chromium.launch();
  const context = await browser.newContext({ locale: "zh-TW" });
  let account = "alice",
    status = "paid",
    creates = 0,
    queries = 0,
    failCreate = false,
    delayUsage = false,
    releaseUsage,
    finishParse;
  const returnLinks = new Map();
  const errors = [];
  context.on("page", (page) =>
    page.on("pageerror", (e) => errors.push(e.message)),
  );
  await context.route("**/api/**", async (route) => {
    const request = route.request(),
      url = new URL(request.url());
    const json = (data) => route.fulfill({ json: data });
    const usage = {
      userId: account,
      paid: false,
      parseCount: 0,
      gpt4oCount: 0,
      gpt4oRemaining: 0,
      freeScansRemaining: 3,
      canExportIcs: false,
      model: "gpt-4o",
      stripeCheckoutEnabled: true,
    };
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
    if (url.pathname === "/api/user/usage") {
      if (delayUsage)
        return new Promise((resolve) => {
          releaseUsage = async () => {
            await json(usage);
            resolve();
          };
        });
      return json(usage);
    }
    if (url.pathname === "/api/parse-schedule")
      return new Promise((resolve) => {
        finishParse = async () => {
          await json({
            courses: [
              { ...edited[0], name: "Late recognition must not overwrite" },
            ],
            usage,
          });
          resolve();
        };
      });
    if (url.pathname === "/api/checkout/return-reference") {
      const link = returnLinks.get(url.searchParams.get("attempt"));
      if (!link || link.account !== account)
        return route.fulfill({ status: 403, json: {} });
      return json({ provider: "stripe", paymentId: link.paymentId });
    }
    if (url.pathname === "/api/recognition/jobs") return json({ jobs: [] });
    if (url.pathname === "/api/account/reviews") return json({ reviews: [] });
    if (
      url.pathname === "/api/checkout/ecpay/status" ||
      url.pathname === "/api/checkout/confirm"
    ) {
      queries++;
      if (status === "error")
        return route.fulfill({
          status: 503,
          json: { error: "fixture unavailable" },
        });
      if (url.pathname === "/api/checkout/confirm" && status === "pending")
        return route.fulfill({ status: 402, json: {} });
      return json({
        ...usage,
        paid: status === "paid",
        canExportIcs: status === "paid",
        paymentStatus: status,
      });
    }
    if (
      request.method() === "POST" &&
      ["/api/checkout/ecpay", "/api/checkout"].includes(url.pathname)
    ) {
      creates++;
      if (failCreate) return route.fulfill({ status: 503, json: {} });
      const { attemptId } = request.postDataJSON();
      returnLinks.set(attemptId, { account, paymentId: "cs_fixture" });
      const target = url.pathname.endsWith("ecpay")
        ? "/?ecpay_order=CC001"
        : "/?checkout=success&session_id=cs_fixture&cc_attempt=" + attemptId;
      if (url.pathname.endsWith("ecpay"))
        return route.fulfill({
          headers: { "content-type": "text/html", "x-cc-payment-id": "CC001" },
          body: `<html><script>location.href=${JSON.stringify(target)}</script></html>`,
        });
      return json({ url: origin + target, sessionId: "cs_fixture" });
    }
    // Never fall through to an actual payment, model, or account API.
    return route.fulfill({ status: 404, json: { error: "Unmocked API" } });
  });
  const page = await context.newPage();
  async function ready(p = page) {
    await p.getByText("最近辨識（7 天內）", { exact: true }).waitFor();
  }
  async function seed(p = page) {
    await p.evaluate((courses) => {
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
    }, edited);
    await p.reload();
    await ready(p);
    await p
      .getByRole("button", { name: "恢復付款前課表", exact: true })
      .first()
      .click();
    await p.getByText(edited[0].name, { exact: true }).first().waitFor();
  }
  async function pay(provider) {
    await page.evaluate(() =>
      window.dispatchEvent(new Event("cc-open-paywall")),
    );
    const dialog = page.getByRole("dialog");
    await dialog
      .getByRole("button", {
        name: provider === "stripe" ? /Stripe/ : /綠界|ECPay/,
      })
      .click();
  }
  try {
    await page.goto(origin + "/#upload");
    await ready();
    await seed();
    for (const provider of ["ecpay", "stripe"]) {
      await Promise.all([
        page.waitForURL((url) =>
          provider === "stripe"
            ? url.searchParams.has("session_id")
            : url.searchParams.has("ecpay_order"),
        ),
        pay(provider),
      ]);
      await ready();
      await page
        .getByText("付款已確認，帳號權益已更新。", { exact: true })
        .waitFor();
      assert.equal(
        await page.getByText(edited[0].name, { exact: true }).count(),
        0,
        "return must not auto-load",
      );
      await page
        .getByRole("button", { name: "恢復付款前課表", exact: true })
        .first()
        .click();
      await page.getByText(edited[0].name, { exact: true }).first().waitFor();
    }
    assert.equal(creates, 2);
    const fresh = await context.newPage();
    await fresh.goto(origin);
    await ready(fresh);
    assert.equal(
      await fresh
        .getByRole("button", { name: "恢復付款前課表", exact: true })
        .count(),
      3,
    );
    await fresh.close();
    // Reject a visibly different draft, then explicitly confirm overwriting.
    await page.evaluate(() => {
      for (const key of Object.keys(localStorage)) {
        if (!key.startsWith("cc_checkout_v1:alice:")) continue;
        const d = JSON.parse(localStorage.getItem(key));
        if (d.paymentId === "cs_fixture") {
          d.courses[0].name = "Restored edited version";
          localStorage.setItem(key, JSON.stringify(d));
        }
      }
      window.dispatchEvent(new Event("storage"));
    });
    page.once("dialog", (dialog) => dialog.dismiss());
    await page
      .getByRole("button", { name: "恢復付款前課表", exact: true })
      .first()
      .click();
    await page.getByText(edited[0].name, { exact: true }).first().waitFor();
    page.once("dialog", (dialog) => dialog.accept());
    await page
      .getByRole("button", { name: "恢復付款前課表", exact: true })
      .first()
      .click();
    await page
      .getByText("Restored edited version", { exact: true })
      .first()
      .waitFor();
    const canceled = new URL(page.url());
    canceled.searchParams.set("checkout", "cancel");
    canceled.searchParams.delete("session_id");
    await page.goto(canceled.href);
    await ready();
    await page
      .getByText("付款已確認，帳號權益已更新。", { exact: true })
      .waitFor();
    // Wrong account must not query or reveal the original account's drafts.
    const returnUrl = page.url();
    account = "bob";
    const before = queries;
    await page.reload();
    await ready();
    await page
      .getByText("請改用付款時的帳號登入，再接續確認與恢復。", { exact: true })
      .waitFor();
    assert.equal(
      await page
        .getByRole("button", { name: "恢復付款前課表", exact: true })
        .count(),
      0,
    );
    assert.equal(queries, before);
    account = null;
    await page.reload();
    await page
      .getByText("請先登入付款時的帳號，再接續確認與恢復。", { exact: true })
      .waitFor();
    account = "alice";
    await page.goto(returnUrl);
    await ready();
    await page
      .getByText("付款已確認，帳號權益已更新。", { exact: true })
      .waitFor();
    status = "pending";
    await page.reload();
    await ready();
    await page
      .getByText("付款尚待確認。若已付款，無須再次付款。", { exact: true })
      .waitFor({ timeout: 45000 });
    const beforeRetry = creates;
    status = "paid";
    await page
      .getByRole("button", { name: "重新查詢付款", exact: true })
      .click();
    await page
      .getByText("付款已確認，帳號權益已更新。", { exact: true })
      .waitFor();
    assert.equal(creates, beforeRetry);
    // Corrupt backup is isolated, and a failed query can be retried.
    await page.evaluate(() =>
      localStorage.setItem("cc_checkout_v1:alice:broken", "{"),
    );
    status = "error";
    await page.reload();
    await ready();
    await page.getByText(/暫時無法確認付款/).waitFor();
    await page.getByText(/部分備份損壞/).waitFor();
    status = "paid";
    await page
      .getByRole("button", { name: "重新查詢付款", exact: true })
      .click();
    await page
      .getByText("付款已確認，帳號權益已更新。", { exact: true })
      .waitFor();
    // Expiry hides backups while leaving payment confirmation available.
    await page.evaluate(() => {
      for (const k of Object.keys(localStorage)) {
        if (k.startsWith("cc_checkout_v1:alice:")) {
          try {
            const d = JSON.parse(localStorage.getItem(k));
            d.savedAt = Date.now() - 8 * 86400000;
            d.expiresAt = d.savedAt + 7 * 86400000;
            localStorage.setItem(k, JSON.stringify(d));
          } catch {
            localStorage.removeItem(k);
          }
        }
      }
    });
    await page.reload();
    await ready();
    assert.equal(
      await page
        .getByRole("button", { name: "恢復付款前課表", exact: true })
        .count(),
      0,
    );
    // Saving failure blocks API creation, explicit bypass is required.
    await seed();
    await page.evaluate(() => {
      const original = Storage.prototype.setItem;
      Storage.prototype.setItem = function (k, v) {
        if (k.startsWith("cc_checkout_")) throw new DOMException("quota");
        return original.call(this, k, v);
      };
    });
    const beforeSaveFail = creates;
    await pay("stripe");
    await page.getByText(/無法保存付款前課表，已留在此頁/).waitFor();
    assert.equal(creates, beforeSaveFail);
    page.once("dialog", (dialog) => dialog.accept());
    await Promise.all([
      page.waitForEvent("load"),
      page
        .getByRole("button", { name: "不保存課表，繼續付款", exact: true })
        .click(),
    ]);
    await ready();
    await page
      .getByText("付款已確認，帳號權益已更新。", { exact: true })
      .waitFor();
    assert.equal(creates, beforeSaveFail + 1);
    // Cancel return must work even when both draft and local attempt writes failed.
    const withoutStorage = new URL(page.url());
    withoutStorage.searchParams.set("checkout", "cancel");
    withoutStorage.searchParams.delete("session_id");
    await page.goto(withoutStorage.href);
    await ready();
    await page
      .getByText("付款已確認，帳號權益已更新。", { exact: true })
      .waitFor();
    // An old account-usage snapshot must not undo confirmed payment benefits.
    delayUsage = true;
    await page.reload();
    await ready();
    await page
      .getByText("付款已確認，帳號權益已更新。", { exact: true })
      .waitFor();
    await releaseUsage();
    await page.evaluate(
      () =>
        new Promise((resolve) =>
          requestAnimationFrame(() => requestAnimationFrame(resolve)),
        ),
    );
    delayUsage = false;
    await page
      .getByRole("button", { name: "恢復付款前課表", exact: true })
      .first()
      .click();
    await page
      .getByRole("button", { name: "下載 .ics 行事曆", exact: true })
      .waitFor();
    // Restoring a draft invalidates the in-flight recognition response.
    await page.goto(origin);
    await ready();
    const image = await page.evaluate(() => {
      const c = document.createElement("canvas");
      c.width = 800;
      c.height = 600;
      return c.toDataURL("image/png").split(",")[1];
    });
    await page.locator('input[type="file"]').setInputFiles({
      name: "fixture.png",
      mimeType: "image/png",
      buffer: Buffer.from(image, "base64"),
    });
    const parseStarted = page.waitForRequest("**/api/parse-schedule");
    await page
      .getByRole("button", { name: "直接使用全圖", exact: true })
      .click();
    await parseStarted;
    await page
      .getByRole("button", { name: "恢復付款前課表", exact: true })
      .first()
      .click();
    await page.getByText(edited[0].name, { exact: true }).first().waitFor();
    await finishParse();
    await page.evaluate(
      () =>
        new Promise((resolve) =>
          requestAnimationFrame(() => requestAnimationFrame(resolve)),
        ),
    );
    assert.equal(
      await page
        .getByText("Late recognition must not overwrite", { exact: true })
        .count(),
      0,
    );
    // Creation failure keeps the edited draft and current schedule.
    await page.goto(origin);
    await ready();
    await seed();
    failCreate = true;
    await pay("ecpay");
    await page.getByText(/付款未能開始/).waitFor();
    await page.getByText(edited[0].name, { exact: true }).first().waitFor();
    await page.getByText("尚未取得付款資訊", { exact: true }).first().waitFor();
    assert.deepEqual(errors, []);
    console.log(
      "PASS: both providers, explicit restore/overwrite, multi-draft persistence, account isolation/login continuation, expiry, corruption, query retry, save failure/bypass, creation failure, cancel with unavailable storage, stale usage and late recognition. No real payment/model API called. Page errors: 0.",
    );
  } finally {
    await browser.close();
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
