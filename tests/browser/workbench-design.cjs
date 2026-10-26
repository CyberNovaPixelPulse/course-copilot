/* eslint-disable @typescript-eslint/no-require-imports */
const { chromium, expect } = require("@playwright/test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const ts = require("typescript");
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
const { getSampleCourses } = require("../../lib/sampleSchedule.ts");
const origin = process.env.CHECKOUT_TEST_ORIGIN || "http://localhost:2999";
const output = process.env.WORKBENCH_CAPTURE_DIR || ".impeccable/review";
(async () => {
  const browser = await chromium.launch();
  fs.mkdirSync(output, { recursive: true });
  try {
    for (const [name, width, height] of [
      ["desktop", 1440, 1000],
      ["user-1280", 1280, 720],
      ["tablet", 768, 1024],
      ["mobile", 390, 844],
    ]) {
      const context = await browser.newContext({
        viewport: { width, height },
        locale: "zh-TW",
        isMobile: width < 640,
        hasTouch: width < 640,
      });
      await context.route("**/api/**", (route) => {
        const path = new URL(route.request().url()).pathname;
        if (path === "/api/auth/session")
          return route.fulfill({
            json: {
              user: {
                id: "design-test",
                name: "設計測試",
                email: "design@example.invalid",
              },
              expires: "2099-01-01T00:00:00Z",
            },
          });
        if (path === "/api/user/usage")
          return route.fulfill({
            json: {
              userId: "design-test",
              freeScansRemaining: 3,
              gpt4oRemaining: 0,
              remaining: 3,
              canExportIcs: false,
              paid: false,
              stripeCheckoutEnabled: true,
            },
          });
        if (path === "/api/parse-schedule") {
          const body = route.request().postDataBuffer().toString();
          const jobId = body.match(/name="jobId"\r\n\r\n([^\r]+)/)?.[1];
          return route.fulfill({
            json: {
              state: "succeeded",
              jobId,
              courses: getSampleCourses("zh-TW"),
            },
          });
        }
        if (path === "/api/recognition/jobs")
          return route.fulfill({ json: { jobs: [] } });
        if (path === "/api/account/reviews")
          return route.fulfill({ json: { reviews: [] } });
        return route.fulfill({ status: 404, json: { error: "Not forwarded" } });
      });
      const page = await context.newPage(),
        errors = [];
      page.on("pageerror", (e) => errors.push(e.message));
      await page.goto(origin);
      await expect(
        page.getByLabel("帳號權益摘要", { exact: true }),
      ).toContainText("免費 3 次");
      await expect(page.getByText("範例課表", { exact: true })).toBeVisible();
      await expect(
        page.getByRole("button", {
          name: "微積分 09:00 to 12:00",
          exact: true,
        }),
      ).toBeDisabled();
      assert.equal(
        await page.evaluate(
          () => document.documentElement.scrollWidth > window.innerWidth,
        ),
        false,
        "No body overflow",
      );
      const source = await page
        .getByRole("complementary", { name: "來源課表" })
        .boundingBox();
      const result = await page.locator(".result-panel").boundingBox();
      assert.ok(
        width >= 1024
          ? result.x > source.x + source.width
          : result.y > source.y + source.height,
        "Responsive source/result composition",
      );
      await page.screenshot({
        path: `${output}/${name}-empty.png`,
        fullPage: true,
      });
      await page.getByRole("button", { name: /沒有課表.*範例/ }).click();
      await expect(page.getByText("範例課表", { exact: true })).toHaveCount(0);
      await expect(
        page.getByRole("button", {
          name: "微積分 09:00 to 12:00",
          exact: true,
        }),
      ).toBeEnabled();
      await page.evaluate(() => window.scrollTo(0, 0));
      await page.screenshot({ path: `${output}/${name}.png`, fullPage: true });
      if (name === "desktop") {
        const base64 = await page.evaluate((courses) => {
          const canvas = document.createElement("canvas");
          canvas.width = 750;
          canvas.height = 520;
          const ctx = canvas.getContext("2d");
          ctx.fillStyle = "#ffffff";
          ctx.fillRect(0, 0, 750, 520);
          ctx.fillStyle = "#233238";
          ctx.font = "24px sans-serif";
          ctx.fillText("範例來源課表", 24, 40);
          ctx.font = "17px sans-serif";
          ["週一", "週二", "週三", "週四", "週五"].forEach((d, i) =>
            ctx.fillText(d, 86 + i * 132, 78),
          );
          ctx.strokeStyle = "#cbd5d6";
          for (let i = 0; i < 6; i++) {
            ctx.beginPath();
            ctx.moveTo(70 + i * 132, 90);
            ctx.lineTo(70 + i * 132, 500);
            ctx.stroke();
          }
          for (let y = 90; y <= 500; y += 82) {
            ctx.beginPath();
            ctx.moveTo(20, y);
            ctx.lineTo(730, y);
            ctx.stroke();
          }
          courses.forEach((course, i) => {
            ctx.fillStyle = "#eaf3ee";
            ctx.fillRect(74 + i * 132, 110 + (i % 3) * 104, 122, 84);
            ctx.fillStyle = "#233238";
            ctx.fillText(
              course.name.slice(0, 6),
              80 + i * 132,
              140 + (i % 3) * 104,
            );
            ctx.font = "14px sans-serif";
            ctx.fillText(
              course.slots[0].startTime,
              80 + i * 132,
              165 + (i % 3) * 104,
            );
            ctx.font = "17px sans-serif";
          });
          return canvas.toDataURL("image/png").split(",")[1];
        }, getSampleCourses("zh-TW"));
        await page
          .locator("input[type=file]")
          .setInputFiles({
            name: "sample-timetable.png",
            mimeType: "image/png",
            buffer: Buffer.from(base64, "base64"),
          });
        await expect(page.getByRole("dialog")).toBeVisible();
        await page.screenshot({
          path: `${output}/desktop-crop.png`,
          fullPage: true,
        });
        await page
          .getByRole("button", { name: "直接使用全圖", exact: true })
          .click();
        const batch = page.getByRole("region", {
          name: "辨識批次",
          exact: true,
        });
        await expect(batch).toContainText("sample-timetable.png — 成功");
        page.once("dialog", (dialog) => dialog.accept());
        await batch
          .getByRole("button", { name: "載入本批次成功結果", exact: true })
          .click();
        await page.evaluate(() => window.scrollTo(0, 0));
        await page.screenshot({
          path: `${output}/desktop-source.png`,
          fullPage: true,
        });
      }
      assert.deepEqual(errors, []);
      await context.close();
    }
    console.log(
      "PASS workbench: genuine readonly preview, explicit sample edit, desktop/tablet/mobile composition, no body overflow or page errors. All APIs intercepted.",
    );
  } finally {
    await browser.close();
  }
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
