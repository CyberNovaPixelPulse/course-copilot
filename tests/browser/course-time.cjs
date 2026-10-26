/* eslint-disable @typescript-eslint/no-require-imports */
const { chromium, expect } = require("@playwright/test");
const assert = require("node:assert/strict");
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
const { coursesToIcs } = require("../../lib/ics.ts");
const origin = process.env.CHECKOUT_TEST_ORIGIN || "http://127.0.0.1:2999";
const slot = (startTime, endTime, weekday = "Monday") => ({
  weekday,
  startTime,
  endTime,
  location: "101",
});
const course = (name, slots) => ({ name, professor: "Fixture", slots });
(async () => {
  const browser = await chromium.launch();
  const context = await browser.newContext({
    locale: "zh-TW",
    viewport: { width: 1280, height: 1000 },
    acceptDownloads: true,
  });
  const errors = [];
  let exports = 0,
    submitted = [];
  context.on("page", (p) => p.on("pageerror", (e) => errors.push(e.message)));
  await context.route("**/api/**", async (route) => {
    const url = new URL(route.request().url());
    if (url.pathname === "/api/auth/session")
      return route.fulfill({
        json: {
          user: { id: "alice", name: "alice", email: "alice@example.invalid" },
          expires: "2099-01-01T00:00:00Z",
        },
      });
    if (url.pathname === "/api/user/usage")
      return route.fulfill({
        json: {
          userId: "alice",
          freeScansRemaining: 3,
          gpt4oRemaining: 0,
          remaining: 3,
          canExportIcs: true,
          paid: true,
          stripeCheckoutEnabled: true,
        },
      });
    if (url.pathname === "/api/account/reviews")
      return route.fulfill({ json: { reviews: [] } });
    if (url.pathname === "/api/recognition/jobs")
      return route.fulfill({ json: { jobs: [] } });
    if (url.pathname === "/api/export-ics") {
      exports++;
      submitted = route.request().postDataJSON().courses;
      return route.fulfill({
        contentType: "text/calendar",
        body: coursesToIcs(submitted),
      });
    }
    return route.fulfill({ status: 404, json: { error: "Not forwarded" } });
  });
  const page = await context.newPage();
  async function restore(courses) {
    await page.evaluate((courses) => {
      const savedAt = Date.now(),
        d = {
          version: 1,
          id: "time-fixture",
          accountId: "alice",
          provider: "stripe",
          savedAt,
          expiresAt: savedAt + 7 * 86400000,
          courses,
        };
      localStorage.setItem(
        "cc_checkout_v1:alice:time-fixture",
        JSON.stringify(d),
      );
    }, courses);
    await page.reload();
    await page
      .getByRole("button", { name: "恢復付款前課表", exact: true })
      .click();
  }
  const edit = () =>
    page
      .getByRole("dialog")
      .filter({ has: page.getByLabel("開始時間", { exact: true }) });
  async function details() {
    await page.getByText("課程明細與精確編輯", { exact: true }).click();
  }
  async function open(name) {
    await details();
    await page
      .getByRole("button", { name: new RegExp("^" + name + " ·") })
      .click();
  }
  try {
    await page.goto(origin + "/#upload");
    await page.getByRole("button", { name: /新增課程/ }).click();
    let dialog = page.getByRole("dialog");
    await dialog.getByLabel("課程名稱", { exact: true }).fill("Early");
    await dialog.getByLabel("開始時間", { exact: true }).fill(" 7:10 ");
    await dialog.getByLabel("結束時間", { exact: true }).fill("08:00");
    await dialog.getByRole("button", { name: "確認新增", exact: true }).click();
    await expect(
      page.getByRole("button", { name: "Early 07:10 to 08:00", exact: true }),
    ).toBeVisible();
    await page.getByRole("button", { name: /新增課程/ }).click();
    dialog = page.getByRole("dialog");
    await dialog.getByLabel("課程名稱", { exact: true }).fill("LateWeekend");
    await dialog.locator("select").selectOption("Sunday");
    await dialog.getByLabel("開始時間", { exact: true }).fill("23:58");
    await dialog.getByLabel("結束時間", { exact: true }).fill("23:59");
    await dialog.getByRole("button", { name: "確認新增", exact: true }).click();
    await expect(
      page.getByRole("button", {
        name: "LateWeekend 23:58 to 23:59",
        exact: true,
      }),
    ).toBeAttached();
    await expect(page.getByText("24:00", { exact: true })).toBeAttached();
    await open("Early");
    await edit().getByLabel("開始時間", { exact: true }).fill("09:00");
    await edit().getByRole("button", { name: "取消", exact: true }).click();
    await expect(
      page.getByRole("button", { name: "Early 07:10 to 08:00", exact: true }),
    ).toBeAttached();
    await page.getByRole("button", { name: /^Early ·/ }).click();
    await edit().getByLabel("開始時間", { exact: true }).fill("07:20");
    await edit().getByRole("button", { name: "完成", exact: true }).click();
    await expect(
      page.getByRole("button", { name: "Early 07:20 to 08:00", exact: true }),
    ).toBeAttached();
    await restore([
      course("Move", [slot("08:10", "09:00")]),
      course("Edge", [slot("21:10", "22:00")]),
    ]);
    const block = page.getByRole("button", {
      name: "Move 08:10 to 09:00",
      exact: true,
    });
    await block.scrollIntoViewIfNeeded();
    let box = await block.boundingBox();
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2 + 18, {
      steps: 4,
    });
    await page.mouse.up();
    await expect(
      page.getByRole("button", { name: "Move 08:25 to 09:15", exact: true }),
    ).toBeAttached();
    // Tiny pointer motion is a click, not a time edit.
    const moved = page.getByRole("button", {
      name: "Move 08:25 to 09:15",
      exact: true,
    });
    box = await moved.boundingBox();
    await page.mouse.move(box.x + 20, box.y + 20);
    await page.mouse.down();
    await page.mouse.move(box.x + 20, box.y + 22);
    await page.mouse.up();
    await expect(edit().getByLabel("開始時間", { exact: true })).toHaveValue(
      "08:25",
    );
    await edit().getByRole("button", { name: "取消", exact: true }).click();
    // Pointer cancellation restores original time after a preview.
    await moved.dispatchEvent("pointerdown", {
      button: 0,
      pointerId: 1,
      clientY: 300,
    });
    await moved.dispatchEvent("pointermove", { pointerId: 1, clientY: 318 });
    await page
      .getByRole("button", { name: "Move 08:40 to 09:30", exact: true })
      .dispatchEvent("pointercancel", { pointerId: 1 });
    await expect(moved).toBeAttached();
    const edge = page.getByRole("button", {
      name: "Edge 21:10 to 22:00",
      exact: true,
    });
    await edge.scrollIntoViewIfNeeded();
    box = await edge.boundingBox();
    await page.mouse.move(box.x + 20, box.y + 20);
    await page.mouse.down();
    await page.mouse.move(box.x + 20, box.y + 56, { steps: 4 });
    await page.mouse.up();
    await expect(edge).toBeAttached();
    await moved.scrollIntoViewIfNeeded();
    const handle = moved.locator('[data-handle="start"]');
    box = await handle.boundingBox();
    await page.mouse.move(box.x + 5, box.y + 3);
    await page.mouse.down();
    await page.mouse.move(box.x + 5, box.y + 200, { steps: 4 });
    await page.mouse.up();
    await expect(
      page.getByRole("button", { name: "Move 09:14 to 09:15", exact: true }),
    ).toBeAttached();
    await restore([
      course("Axis", [slot("07:10", "08:00")]),
      course("EarlyBoundary", [slot("08:10", "09:00")]),
    ]);
    const axis = page.getByRole("button", {
      name: "Axis 07:10 to 08:00",
      exact: true,
    });
    await axis.scrollIntoViewIfNeeded();
    box = await axis.boundingBox();
    await page.mouse.move(box.x + 20, box.y + 20);
    await page.mouse.down();
    await page.mouse.move(box.x + 20, box.y + 92, { steps: 5 });
    await expect(page.getByText("07:00", { exact: true })).toHaveCount(1);
    await expect(
      page.getByRole("button", { name: "Axis 08:10 to 09:00", exact: true }),
    ).toBeAttached();
    await page.mouse.up();
    await expect(page.getByText("07:00", { exact: true })).toHaveCount(0);
    const early = page.getByRole("button", {
      name: "EarlyBoundary 08:10 to 09:00",
      exact: true,
    });
    await early.scrollIntoViewIfNeeded();
    box = await early.boundingBox();
    await page.mouse.move(box.x + 20, box.y + 20);
    await page.mouse.down();
    await page.mouse.move(box.x + 20, box.y - 16, { steps: 5 });
    await page.mouse.up();
    const boundedEarly = page.getByRole("button", {
      name: "EarlyBoundary 08:00 to 08:50",
      exact: true,
    });
    await expect(boundedEarly).toBeAttached();
    const endHandle = boundedEarly.locator('[data-handle="end"]');
    box = await endHandle.boundingBox();
    await page.mouse.move(box.x + 5, box.y + 3);
    await page.mouse.down();
    await page.mouse.move(box.x + 5, box.y + 21, { steps: 4 });
    await page.mouse.up();
    await expect(
      page.getByRole("button", {
        name: "EarlyBoundary 08:00 to 09:05",
        exact: true,
      }),
    ).toBeAttached();
    await restore([
      course("Broken", [slot("08:99", "09:00", "Funday")]),
      course("Empty", []),
      course("Overlap", [slot("09:00", "10:00"), slot("09:30", "10:30")]),
    ]);
    await expect(
      page.getByRole("region", { name: "待修正課程" }),
    ).toBeAttached();
    await page.getByRole("button", { name: /下載.*ics|下載行事曆/i }).click();
    assert.equal(exports, 0);
    const problems = page.getByRole("region", { name: "待修正課程" });
    await problems
      .getByRole("button", { name: "編輯修正", exact: true })
      .first()
      .click();
    await edit().getByLabel("開始時間", { exact: true }).fill("07:10");
    await edit().getByLabel("結束時間", { exact: true }).fill("08:00");
    await edit().locator("select").selectOption("Saturday");
    await edit().getByRole("button", { name: "完成", exact: true }).click();
    await problems
      .getByRole("button", { name: "編輯修正", exact: true })
      .click();
    await edit().locator("input").nth(2).fill("新教室 302");
    await edit().getByRole("button", { name: "完成", exact: true }).click();
    await expect(problems).toHaveCount(0);
    await expect(
      page.getByText("課程時段重疊，請檢查；仍可保留並輸出。", { exact: true }),
    ).toBeVisible();
    await page.screenshot({
      path: "/tmp/course-time-desktop.png",
      fullPage: true,
    });
    await page.getByRole("button", { name: /下載.*ics|下載行事曆/i }).click();
    const img = page.locator('img[src^="blob:"]');
    await expect(img).toBeVisible({ timeout: 20000 });
    const size = await img.evaluate((img) => ({
      width: img.naturalWidth,
      height: img.naturalHeight,
    }));
    assert.equal(size.width, 1080);
    assert.equal(size.height, 2400);
    const blob = await img.evaluate(async (img) =>
      Array.from(new Uint8Array(await (await fetch(img.src)).arrayBuffer())),
    );
    fs.writeFileSync("/tmp/course-time-share.png", Buffer.from(blob));
    assert.equal(submitted.flatMap((c) => c.slots).length, 4);
    assert.equal(
      submitted.find((c) => c.name === "Empty").slots[0].location,
      "新教室 302",
    );
    await restore([course("Last", [slot("09:00", "10:00")])]);
    await open("Last");
    page.once("dialog", (d) => d.dismiss());
    await edit()
      .getByRole("button", { name: "刪除這門課", exact: true })
      .click();
    await expect(edit()).toBeVisible();
    page.once("dialog", (d) => d.accept());
    await edit()
      .getByRole("button", { name: "刪除這門課", exact: true })
      .click();
    await expect(
      page.getByRole("button", { name: "Last 09:00 to 10:00", exact: true }),
    ).toHaveCount(0);
    await restore([
      course("Midnight", [slot("00:00", "00:01")]),
      course("FinalMinute", [slot("23:58", "23:59", "Sunday")]),
    ]);
    await page.getByRole("button", { name: /下載.*ics|下載行事曆/i }).click();
    const extremeImg = page.locator('img[src^="blob:"]');
    await expect(extremeImg).toBeVisible({ timeout: 20000 });
    const extremeBlob = await extremeImg.evaluate(async (img) =>
      Array.from(new Uint8Array(await (await fetch(img.src)).arrayBuffer())),
    );
    fs.writeFileSync(
      "/tmp/course-time-extreme-share.png",
      Buffer.from(extremeBlob),
    );
    await restore([
      course("很長的課程名稱".repeat(25), [slot("00:00", "00:01")]),
      course("FinalMinute", [slot("23:58", "23:59", "Sunday")]),
    ]);
    await page.getByRole("button", { name: /下載.*ics|下載行事曆/i }).click();
    await expect(extremeImg).toBeVisible({ timeout: 20000 });
    assert.ok((await extremeImg.evaluate((img) => img.naturalHeight)) > 2160);
    const longBlob = await extremeImg.evaluate(async (img) =>
      Array.from(new Uint8Array(await (await fetch(img.src)).arrayBuffer())),
    );
    fs.writeFileSync(
      "/tmp/course-time-long-name-share.png",
      Buffer.from(longBlob),
    );
    await page.reload();
    await page
      .getByRole("button", { name: "恢復付款前課表", exact: true })
      .click();
    await page.setViewportSize({ width: 390, height: 844 });
    await page.screenshot({
      path: "/tmp/course-time-mobile.png",
      fullPage: true,
    });
    assert.deepEqual(errors, []);
    console.log(
      "PASS course time: precise add/edit, early/late/weekend, cancel/drag, repair/empty slot, overlap, invalid export block, actual share PNG. Page errors:0. No real model/payment.",
    );
  } finally {
    await browser.close();
  }
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
