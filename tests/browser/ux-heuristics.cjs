/* eslint-disable @typescript-eslint/no-require-imports */
const { chromium, expect } = require("@playwright/test");
const assert = require("node:assert/strict");
const origin = process.env.CHECKOUT_TEST_ORIGIN || "http://localhost:2999";
(async () => {
  const browser = await chromium.launch();
  const mobile = process.env.UX_MOBILE === "1";
  const context = await browser.newContext({
    viewport: mobile
      ? { width: 390, height: 844 }
      : { width: 1280, height: 1000 },
    isMobile: mobile,
    hasTouch: mobile,
    locale: "zh-TW",
  });
  let account = "alice";
  const downloads = [];
  await context.route("**/api/**", (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path === "/api/auth/session")
      return route.fulfill({
        json: {
          user: {
            id: account,
            name: account,
            email: account + "@example.invalid",
          },
          expires: "2099-01-01T00:00:00Z",
        },
      });
    if (path === "/api/user/usage")
      return route.fulfill({
        json: {
          userId: account,
          freeScansRemaining: 3,
          gpt4oRemaining: 0,
          remaining: 3,
          canExportIcs: true,
          paid: true,
          stripeCheckoutEnabled: true,
        },
      });
    if (path === "/api/export-ics")
      return route.fulfill({
        contentType: "text/calendar",
        body: "BEGIN:VCALENDAR\r\nVERSION:2.0\r\nBEGIN:VEVENT\r\nDTSTART:20261026T090000\r\nDTEND:20261026T100000\r\nRRULE:FREQ=WEEKLY;COUNT=16\r\nSUMMARY:Original\r\nEND:VEVENT\r\nEND:VCALENDAR\r\n",
      });
    if (path === "/api/account/reviews")
      return route.fulfill({ json: { reviews: [] } });
    if (path === "/api/recognition/jobs")
      return route.fulfill({ json: { jobs: [] } });
    return route.fulfill({ status: 404, json: { error: "Not forwarded" } });
  });
  const page = await context.newPage();
  page.on("download", (d) => downloads.push(d));
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  async function add(name) {
    await page.getByRole("button", { name: /新增課程/ }).click();
    const d = page.getByRole("dialog");
    await d.getByLabel("課程名稱", { exact: true }).fill(name);
    await d.getByRole("button", { name: "確認新增", exact: true }).click();
  }
  try {
    await page.goto(origin + "/#upload");
    await add("Original");
    await page.getByText("課程明細與精確編輯", { exact: true }).click();
    await page.getByRole("button", { name: /^Original ·/ }).click();
    let d = page.getByRole("dialog");
    await d.locator("input").nth(0).fill("Cancelled");
    await d.locator("input").nth(1).fill("Cancelled teacher");
    await d.locator("input").nth(2).fill("Cancelled room");
    await d.getByLabel("開始時間", { exact: true }).fill("09:30");
    await d.getByRole("button", { name: "取消", exact: true }).click();
    await expect(
      page.getByRole("button", {
        name: "Original 09:00 to 10:00",
        exact: true,
      }),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: /^Cancelled ·/ }),
    ).toHaveCount(0);
    await page.reload();
    await page
      .getByRole("button", { name: "恢復上次編輯草稿", exact: true })
      .click();
    await expect(
      page.getByRole("button", {
        name: "Original 09:00 to 10:00",
        exact: true,
      }),
    ).toBeVisible();
    await page.getByRole("button", { name: /沒有課表.*範例/ }).click();
    await page
      .getByRole("button", { name: "復原範例替換", exact: true })
      .click({ timeout: 3000 });
    await expect(
      page.getByRole("button", {
        name: "Original 09:00 to 10:00",
        exact: true,
      }),
    ).toBeVisible();
    // A failed discard must not leave the save-retry action blocked by an old draft.
    await page.reload();
    await page
      .getByRole("button", { name: "恢復上次編輯草稿", exact: true })
      .waitFor();
    await add("Original");
    await add("CurrentOnly");
    await page.evaluate(() => {
      const remove = Storage.prototype.removeItem;
      Storage.prototype.removeItem = function (k) {
        if (k.startsWith("cc_schedule_draft_v1:"))
          throw new Error("Fixture removal failure");
        return remove.call(this, k);
      };
    });
    await page
      .getByRole("button", { name: "捨棄舊草稿，保留目前課表", exact: true })
      .click();
    await page
      .getByRole("button", { name: "重試保存目前課表", exact: true })
      .click();
    await expect(page.getByRole("region", { name: "編輯草稿" })).toContainText(
      "已保存在此瀏覽器",
    );
    await page.reload();
    await page
      .getByRole("button", { name: "恢復上次編輯草稿", exact: true })
      .click();
    await expect(
      page.getByRole("button", {
        name: "CurrentOnly 09:00 to 10:00",
        exact: true,
      }),
    ).toBeVisible();
    await page.getByRole("button", { name: /新增課程/ }).click();
    d = page.getByRole("dialog");
    for (let i = 0; i < 14; i++) {
      await page.keyboard.press("Tab");
      assert.ok(
        await page.evaluate(
          () => !!document.activeElement.closest('dialog,[role="dialog"]'),
        ),
        "Tab remains in the modal",
      );
    }
    await page.keyboard.press("Escape");
    await expect(d).toHaveCount(0);
    await page.getByRole("button", { name: /下載.*ics|下載行事曆/i }).click();
    d = page.getByRole("dialog", { name: "行事曆檔案已準備好", exact: true });
    await expect(d).toContainText("2026-10-26 – 2027-02-08");
    await expect(d).toContainText("每週重複 16 次");
    assert.equal(
      downloads.length,
      0,
      "No delivery before the user can inspect dates",
    );
    await d.getByRole("button", { name: "下載 ICS 檔案", exact: true }).click();
    await expect.poll(() => downloads.length).toBe(1);
    await page.keyboard.press("Escape");
    await page.evaluate(() => {
      const original = Storage.prototype.setItem;
      Storage.prototype.setItem = function (k, v) {
        if (window.__blockDraft && k.startsWith("cc_schedule_draft_v1:"))
          throw new Error("Fixture quota");
        return original.call(this, k, v);
      };
      window.__blockDraft = true;
    });
    await add("Unsaved");
    await expect(
      page.getByRole("region", { name: "編輯草稿" }).getByRole("alert"),
    ).toContainText("草稿無法讀取或保存");
    await page.evaluate(() => {
      window.__blockDraft = false;
    });
    await page
      .getByRole("button", { name: "重試保存目前課表", exact: true })
      .click();
    await expect(page.getByRole("region", { name: "編輯草稿" })).toContainText(
      "已保存在此瀏覽器",
    );
    account = "bob";
    await page.evaluate(() =>
      document.dispatchEvent(new Event("visibilitychange")),
    );
    await expect(
      page.getByRole("button", {
        name: "Original 09:00 to 10:00",
        exact: true,
      }),
    ).toHaveCount(0);
    await expect(
      page.getByRole("button", { name: "恢復上次編輯草稿", exact: true }),
    ).toHaveCount(0);
    await add("Bob only");
    await expect(page.getByRole("region", { name: "編輯草稿" })).toContainText(
      "已保存在此瀏覽器",
    );
    account = "alice";
    await page.evaluate(() =>
      document.dispatchEvent(new Event("visibilitychange")),
    );
    await page
      .getByRole("button", { name: "恢復上次編輯草稿", exact: true })
      .click();
    await expect(
      page.getByRole("button", {
        name: "Original 09:00 to 10:00",
        exact: true,
      }),
    ).toBeVisible();
    await expect(
      page.getByRole("button", {
        name: "Bob only 09:00 to 10:00",
        exact: true,
      }),
    ).toHaveCount(0);
    await page.getByText("課程明細與精確編輯", { exact: true }).click();
    await expect(
      page.getByRole("button", { name: /^Original · 週一/ }),
    ).toBeVisible();
    if (mobile) {
      const nav = page.getByRole("navigation", { name: "星期快速定位" });
      await nav.getByRole("button", { name: "週五", exact: true }).click();
      await expect
        .poll(() =>
          page
            .locator(".overflow-x-auto")
            .first()
            .evaluate((el) => el.scrollLeft),
        )
        .toBeGreaterThan(0);
      for (const control of [
        page.getByRole("button", { name: /新增課程/ }),
        page.getByRole("button", { name: "開啟選單", exact: true }),
        page.getByRole("button", { name: "下載 .ics 行事曆", exact: true }),
      ]) {
        const rect = await control.boundingBox();
        assert.ok(
          rect.height >= 44 && rect.width >= 44,
          "Comfortable mobile control target",
        );
      }
    }
    await page.screenshot({
      path: mobile
        ? "/tmp/ux-improved-mobile.png"
        : "/tmp/ux-improved-desktop.png",
      fullPage: true,
    });
    assert.deepEqual(errors, []);
    console.log(
      "PASS UX: whole-edit cancel, reload recovery, sample undo, modal focus, dates before delivery, save failure/retry, account isolation. Page errors:0.",
    );
  } finally {
    await browser.close();
  }
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
