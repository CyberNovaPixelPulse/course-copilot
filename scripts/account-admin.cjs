/* eslint-disable @typescript-eslint/no-require-imports */
// This tool intentionally uses explicit subcommands and defaults to read-only audit.
const fs = require("node:fs");
const path = require("node:path");
const Module = require("node:module");
const ts = require("typescript");
const root = path.resolve(__dirname, "..");
const resolve = Module._resolveFilename;
Module._resolveFilename = function (id, ...args) {
  return resolve.call(
    this,
    id.startsWith("@/") ? path.join(root, id.slice(2)) : id,
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
const { getTurso } = require("../lib/turso.ts");
const { createAccountEntitlements } = require("../lib/account-entitlements.ts");
async function main() {
  const [command = "audit", ...args] = process.argv.slice(2);
  const db = getTurso();
  try {
    const store = createAccountEntitlements(db);
    if (command === "audit") {
      // No schema creation, imports, account grants or changes in audit mode.
      const tables = await db.execute(
        "SELECT name FROM sqlite_master WHERE type='table' AND name IN ('cc_ecpay_orders','cc_ecpay_usage','cc_reviews','cc_grants')",
      );
      const names = new Set(tables.rows.map((r) => r.name));
      console.log(
        "Read-only audit. Legacy token/coupon/Stripe ownership is NOT inferred.",
      );
      if (names.has("cc_ecpay_orders")) {
        const rows = await db.execute(
          `SELECT account_id,COUNT(*) AS paid_orders${names.has("cc_ecpay_usage") ? ",COALESCE((SELECT used_count FROM cc_ecpay_usage u WHERE u.account_id=o.account_id),0) AS legacy_used" : ""} FROM cc_ecpay_orders o WHERE paid_at IS NOT NULL GROUP BY account_id`,
        );
        console.log(JSON.stringify(rows.rows, null, 2));
      }
      if (names.has("cc_grants")) {
        const filter = args[0];
        console.log(
          JSON.stringify(
            (
              await db.execute(
                filter
                  ? {
                      sql: "SELECT source,account_id,credits,created_at FROM cc_grants WHERE account_id=? ORDER BY created_at",
                      args: [filter],
                    }
                  : "SELECT source,account_id,credits,created_at FROM cc_grants ORDER BY created_at",
              )
            ).rows,
            null,
            2,
          ),
        );
      }
      if (names.has("cc_reviews"))
        console.log(
          JSON.stringify(
            (
              await db.execute(
                "SELECT id,account_id,evidence,status FROM cc_reviews WHERE status='pending'",
              )
            ).rows,
            null,
            2,
          ),
        );
    } else if (
      command === "import-ecpay" &&
      args.length === 2 &&
      args[1] === "--apply"
    ) {
      await store.importEcpay(args[0]);
      console.log(JSON.stringify(await store.usage(args[0])));
    } else if (
      command === "resolve" &&
      args.length === 6 &&
      args[5] === "--apply"
    ) {
      const [reviewId, amount, exportFlag, reason, source] = args;
      if (!/^(true|false)$/.test(exportFlag))
        throw new Error("Export eligibility must be true or false.");
      await store.resolveReview(
        reviewId,
        Number(amount),
        exportFlag === "true",
        reason,
        source,
      );
      console.log("Review resolved (or already resolved).");
    } else if (
      command === "initialize-free" &&
      args.length === 4 &&
      args[3] === "--apply"
    ) {
      await store.initializeLegacyFree(args[0], Number(args[1]), args[2]);
      console.log("Legacy free allowance initialized.");
    } else if (
      command === "cleanup" &&
      args.length === 1 &&
      args[0] === "--apply"
    ) {
      await store.cleanup();
      console.log(
        "Expired reservations released and expired result content deleted.",
      );
    } else
      throw new Error(
        'Usage: audit | import-ecpay ACCOUNT --apply | resolve REVIEW_ID CREDITS true|false "verified reason" VERIFIED_SOURCE --apply | initialize-free ACCOUNT REMAINING EVIDENCE_ID --apply | cleanup --apply',
      );
  } finally {
    db.close();
  }
}
main().catch((e) => {
  console.error(e.message);
  process.exitCode = 1;
});
