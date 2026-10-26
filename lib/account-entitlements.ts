import type { Client, Transaction } from "@libsql/client";
import { randomUUID } from "crypto";
import type { Course } from "./types";

export class AccountError extends Error {
  constructor(
    public code: string,
    public status = 409,
  ) {
    super(code);
  }
}
export type AccountUsage = {
  freeRemaining: number;
  creditRemaining: number;
  remaining: number;
  canExport: boolean;
};
export function createAccountEntitlements(
  db: Client,
  clock = () => Date.now(),
) {
  let ready: Promise<unknown> | undefined;
  async function schema() {
    ready ??= db
      .batch(
        [
          `CREATE TABLE IF NOT EXISTS cc_accounts (id TEXT PRIMARY KEY, free INTEGER NOT NULL DEFAULT 3 CHECK(free>=0), credits INTEGER NOT NULL DEFAULT 0 CHECK(credits>=0), can_export INTEGER NOT NULL DEFAULT 0)`,
          `CREATE TABLE IF NOT EXISTS cc_grants (source TEXT PRIMARY KEY, account_id TEXT NOT NULL, credits INTEGER NOT NULL, created_at INTEGER NOT NULL)`,
          `CREATE TABLE IF NOT EXISTS cc_jobs (id TEXT NOT NULL, account_id TEXT NOT NULL, fingerprint TEXT NOT NULL, state TEXT NOT NULL, bucket TEXT NOT NULL, created_at INTEGER NOT NULL, expires_at INTEGER NOT NULL, finished_at INTEGER, result TEXT, PRIMARY KEY(account_id,id))`,
          `CREATE INDEX IF NOT EXISTS cc_jobs_expiry ON cc_jobs(state,expires_at)`,
          `CREATE TABLE IF NOT EXISTS cc_redemptions (account_id TEXT NOT NULL, code TEXT NOT NULL, created_at INTEGER NOT NULL, PRIMARY KEY(account_id,code))`,
          `CREATE TABLE IF NOT EXISTS cc_reviews (id TEXT PRIMARY KEY, account_id TEXT NOT NULL, evidence TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'pending', reason TEXT, created_at INTEGER NOT NULL, UNIQUE(account_id,evidence))`,
          `CREATE TABLE IF NOT EXISTS cc_stripe_checkouts (id TEXT PRIMARY KEY, account_id TEXT NOT NULL, amount INTEGER NOT NULL, currency TEXT NOT NULL)`,
        ],
        "write",
      )
      .catch((e) => {
        ready = undefined;
        throw e;
      });
    await ready;
  }
  // Database write transactions serialize changes across processes; this queue also
  // prevents nested transactions on a shared in-process SQLite connection.
  let tail: Promise<unknown> = Promise.resolve();
  async function write<T>(work: (tx: Transaction) => Promise<T>): Promise<T> {
    const run = tail.then(async () => {
      await schema();
      const tx = await db.transaction("write");
      try {
        const value = await work(tx);
        await tx.commit();
        return value;
      } catch (e) {
        await tx.rollback();
        throw e;
      } finally {
        tx.close();
      }
    });
    tail = run.catch(() => undefined);
    return run;
  }
  async function account(tx: Transaction, id: string) {
    if (!id || id.length > 320) throw new AccountError("auth", 401);
    await tx.execute({
      sql: "INSERT OR IGNORE INTO cc_accounts(id) VALUES (?)",
      args: [id],
    });
  }
  async function expire(tx: Transaction) {
    const now = clock();
    const expired = await tx.execute({
      sql: "SELECT account_id,bucket,COUNT(*) AS n FROM cc_jobs WHERE state='running' AND expires_at<=? GROUP BY account_id,bucket",
      args: [now],
    });
    for (const row of expired.rows) {
      const field = row.bucket === "free" ? "free" : "credits";
      await tx.execute({
        sql: `UPDATE cc_accounts SET ${field}=${field}+? WHERE id=?`,
        args: [Number(row.n), String(row.account_id)],
      });
    }
    await tx.execute({
      sql: "UPDATE cc_jobs SET state='expired',finished_at=? WHERE state='running' AND expires_at<=?",
      args: [now, now],
    });
    await tx.execute({
      sql: "UPDATE cc_jobs SET result=NULL WHERE result IS NOT NULL AND finished_at<=?",
      args: [now - 7 * 86400000],
    });
  }
  async function snapshot(tx: Transaction, id: string): Promise<AccountUsage> {
    const row = (
      await tx.execute({
        sql: "SELECT * FROM cc_accounts WHERE id=?",
        args: [id],
      })
    ).rows[0];
    return {
      freeRemaining: Number(row.free),
      creditRemaining: Number(row.credits),
      remaining: Number(row.free) + Number(row.credits),
      canExport: Boolean(row.can_export),
    };
  }
  async function grant(
    tx: Transaction,
    id: string,
    source: string,
    credits: number,
    canExport = true,
  ) {
    await account(tx, id);
    const prior = (
      await tx.execute({
        sql: "SELECT account_id,credits FROM cc_grants WHERE source=?",
        args: [source],
      })
    ).rows[0];
    if (prior) {
      if (prior.account_id !== id || Number(prior.credits) !== credits)
        throw new AccountError("grant_conflict");
      return;
    }
    if (!Number.isSafeInteger(credits) || credits < 0)
      throw new AccountError("invalid_credits", 400);
    await tx.execute({
      sql: "INSERT INTO cc_grants VALUES (?,?,?,?)",
      args: [source, id, credits, clock()],
    });
    await tx.execute({
      sql: "UPDATE cc_accounts SET credits=credits+?,can_export=MAX(can_export,?) WHERE id=?",
      args: [credits, canExport ? 1 : 0, id],
    });
  }
  return {
    async usage(id: string) {
      return write(async (tx) => {
        await account(tx, id);
        await expire(tx);
        return snapshot(tx, id);
      });
    },
    async grant(id: string, source: string, credits: number, canExport = true) {
      return write(async (tx) => {
        await grant(tx, id, source, credits, canExport);
        return snapshot(tx, id);
      });
    },
    async begin(id: string, jobId: string, fingerprint: string) {
      if (!/^[a-zA-Z0-9_-]{16,100}$/.test(jobId))
        throw new AccountError("invalid_job", 400);
      return write(async (tx) => {
        await account(tx, id);
        await expire(tx);
        const old = (
          await tx.execute({
            sql: "SELECT * FROM cc_jobs WHERE account_id=? AND id=?",
            args: [id, jobId],
          })
        ).rows[0];
        if (old) {
          if (old.fingerprint !== fingerprint)
            throw new AccountError("job_conflict");
          return {
            funding: String(old.bucket),
            started: false,
            state: String(old.state),
            courses: old.result
              ? (JSON.parse(String(old.result)) as Course[])
              : null,
          };
        }
        const usage = await snapshot(tx, id);
        if (!usage.remaining)
          throw new AccountError("insufficient_credits", 402);
        const bucket = usage.freeRemaining > 0 ? "free" : "credits";
        await tx.execute({
          sql: `UPDATE cc_accounts SET ${bucket}=${bucket}-1 WHERE id=?`,
          args: [id],
        });
        await tx.execute({
          sql: "INSERT INTO cc_jobs(id,account_id,fingerprint,state,bucket,created_at,expires_at) VALUES (?,?,?,?,?,?,?)",
          args: [
            jobId,
            id,
            fingerprint,
            "running",
            bucket,
            clock(),
            clock() + 180000,
          ],
        });
        return {
          started: true,
          state: "running",
          courses: null,
          funding: bucket,
        };
      });
    },
    async complete(id: string, jobId: string, courses: Course[]) {
      if (!courses.length || !courses.some((c) => c.slots.length))
        throw new AccountError("empty_result", 422);
      return write(async (tx) => {
        await expire(tx);
        const row = (
          await tx.execute({
            sql: "SELECT state,result FROM cc_jobs WHERE account_id=? AND id=?",
            args: [id, jobId],
          })
        ).rows[0];
        if (!row) throw new AccountError("not_found", 404);
        if (row.state === "succeeded") return;
        if (row.state !== "running") throw new AccountError("job_expired");
        await tx.execute({
          sql: "UPDATE cc_jobs SET state='succeeded',result=?,finished_at=? WHERE account_id=? AND id=? AND state='running'",
          args: [JSON.stringify(courses), clock(), id, jobId],
        });
      });
    },
    async fail(id: string, jobId: string) {
      return write(async (tx) => {
        await expire(tx);
        const row = (
          await tx.execute({
            sql: "SELECT bucket FROM cc_jobs WHERE account_id=? AND id=? AND state='running'",
            args: [id, jobId],
          })
        ).rows[0];
        if (!row) return;
        const bucket = row.bucket === "free" ? "free" : "credits";
        await tx.execute({
          sql: `UPDATE cc_accounts SET ${bucket}=${bucket}+1 WHERE id=?`,
          args: [id],
        });
        await tx.execute({
          sql: "UPDATE cc_jobs SET state='failed',finished_at=? WHERE account_id=? AND id=?",
          args: [clock(), id, jobId],
        });
      });
    },
    async jobs(id: string, jobId?: string) {
      return write(async (tx) => {
        await account(tx, id);
        await expire(tx);
        const result = await tx.execute(
          jobId
            ? {
                sql: "SELECT id,state,result,created_at,finished_at FROM cc_jobs WHERE account_id=? AND id=?",
                args: [id, jobId],
              }
            : {
                sql: "SELECT id,state,result,created_at,finished_at FROM cc_jobs WHERE account_id=? AND created_at>? ORDER BY created_at DESC LIMIT 50",
                args: [id, clock() - 7 * 86400000],
              },
        );
        return result.rows.map((r) => ({
          id: String(r.id),
          state: String(r.state),
          createdAt: Number(r.created_at),
          courses: r.result ? (JSON.parse(String(r.result)) as Course[]) : null,
        }));
      });
    },
    async redeem(id: string, code: string) {
      return write(async (tx) => {
        await account(tx, id);
        if (
          (
            await tx.execute({
              sql: "SELECT 1 FROM cc_redemptions WHERE account_id=? AND code=?",
              args: [id, code],
            })
          ).rows.length
        )
          return snapshot(tx, id);
        const coupon = (
          await tx.execute({
            sql: "SELECT * FROM coupons WHERE upper(code)=? AND site_id='course-copilot' AND is_active=1",
            args: [code],
          })
        ).rows[0];
        if (!coupon) throw new AccountError("inactive", 400);
        const end = coupon.expires_at
          ? Date.parse(String(coupon.expires_at))
          : null;
        if (end !== null && (!Number.isFinite(end) || end <= clock()))
          throw new AccountError("expired", 400);
        const credits =
          coupon.discount_type === "credits"
            ? Number(coupon.discount_value)
            : 30;
        if (!Number.isSafeInteger(credits) || credits <= 0)
          throw new AccountError("inactive", 400);
        const claimed = await tx.execute({
          sql: "UPDATE coupons SET used_count=used_count+1 WHERE id=? AND is_active=1 AND (max_uses=-1 OR used_count<max_uses)",
          args: [String(coupon.id)],
        });
        if (!claimed.rowsAffected) throw new AccountError("limit", 400);
        await tx.execute({
          sql: "INSERT INTO cc_redemptions VALUES (?,?,?)",
          args: [id, code, clock()],
        });
        await grant(tx, id, `coupon:${id}:${code}`, credits);
        return snapshot(tx, id);
      });
    },
    async importEcpay(id: string) {
      return write(async (tx) => {
        await account(tx, id);
        const orders = (
          await tx.execute({
            sql: "SELECT trade_no FROM cc_ecpay_orders WHERE account_id=? AND paid_at IS NOT NULL ORDER BY created_at,trade_no",
            args: [id],
          })
        ).rows;
        if (!orders.length) return;
        // Import only the durable paid-order pool less durable legacy usage; never
        // trust the initial entitlement snapshot as coupon or Stripe evidence.
        const source = `migration:ecpay:${id}`;
        const imported = (
          await tx.execute({
            sql: "SELECT 1 FROM cc_grants WHERE source=?",
            args: [source],
          })
        ).rows.length;
        if (!imported) {
          const usage = (
            await tx.execute({
              sql: "SELECT used_count FROM cc_ecpay_usage WHERE account_id=?",
              args: [id],
            })
          ).rows[0];
          await grant(
            tx,
            id,
            source,
            Math.max(0, orders.length * 30 - Number(usage?.used_count ?? 0)),
          );
          for (const row of orders)
            await tx.execute({
              sql: "INSERT INTO cc_grants VALUES (?,?,0,?)",
              args: [`ecpay:${row.trade_no}`, id, clock()],
            });
        } else
          for (const row of orders) {
            const key = `ecpay:${row.trade_no}`;
            if (
              !(
                await tx.execute({
                  sql: "SELECT 1 FROM cc_grants WHERE source=?",
                  args: [key],
                })
              ).rows.length
            )
              await grant(tx, id, key, 30);
          }
      });
    },
    async saveCheckout(
      id: string,
      session: string,
      amount: number,
      currency: string,
    ) {
      return write(async (tx) => {
        await account(tx, id);
        await tx.execute({
          sql: "INSERT INTO cc_stripe_checkouts VALUES (?,?,?,?)",
          args: [session, id, amount, currency.toLowerCase()],
        });
      });
    },
    async confirmStripe(session: {
      id: string;
      payment_status: string;
      client_reference_id: string | null;
      metadata: Record<string, string> | null;
      amount_total: number | null;
      currency: string | null;
    }) {
      return write(async (tx) => {
        const order = (
          await tx.execute({
            sql: "SELECT * FROM cc_stripe_checkouts WHERE id=?",
            args: [session.id],
          })
        ).rows[0];
        if (!order) throw new AccountError("payment_review_required", 409);
        if (session.payment_status !== "paid")
          throw new AccountError("payment_pending", 402);
        if (
          order.account_id !== session.client_reference_id ||
          order.account_id !== session.metadata?.userId ||
          Number(order.amount) !== session.amount_total ||
          order.currency !== session.currency
        )
          throw new AccountError("payment_mismatch", 403);
        await grant(tx, String(order.account_id), `stripe:${session.id}`, 30);
        return String(order.account_id);
      });
    },
    async requestReview(id: string, evidence: string) {
      return write(async (tx) => {
        await account(tx, id);
        await tx.execute({
          sql: "INSERT OR IGNORE INTO cc_reviews(id,account_id,evidence,created_at) VALUES (?,?,?,?)",
          args: [randomUUID(), id, evidence, clock()],
        });
        return (
          await tx.execute({
            sql: "SELECT id,status,reason,created_at FROM cc_reviews WHERE account_id=? ORDER BY created_at DESC LIMIT 30",
            args: [id],
          })
        ).rows;
      });
    },
    async reviews(id: string) {
      return write(async (tx) => {
        await account(tx, id);
        return (
          await tx.execute({
            sql: "SELECT id,status,reason,created_at FROM cc_reviews WHERE account_id=? ORDER BY created_at DESC LIMIT 30",
            args: [id],
          })
        ).rows;
      });
    },
    async resolveReview(
      reviewId: string,
      credits: number,
      canExport: boolean,
      reason: string,
      verifiedSource: string,
    ) {
      return write(async (tx) => {
        if (!verifiedSource?.trim() || verifiedSource.length > 200)
          throw new AccountError("source_required", 400);
        if (!reason.trim()) throw new AccountError("reason_required", 400);
        const row = (
          await tx.execute({
            sql: "SELECT * FROM cc_reviews WHERE id=?",
            args: [reviewId],
          })
        ).rows[0];
        if (!row) throw new AccountError("not_found", 404);
        if (row.status !== "pending") return;
        await grant(
          tx,
          String(row.account_id),
          verifiedSource,
          credits,
          canExport,
        );
        await tx.execute({
          sql: "UPDATE cc_reviews SET status='resolved',reason=? WHERE id=?",
          args: [reason, reviewId],
        });
      });
    },
    async initializeLegacyFree(
      id: string,
      remaining: number,
      evidenceId: string,
    ) {
      return write(async (tx) => {
        if (
          !Number.isInteger(remaining) ||
          remaining < 0 ||
          remaining > 3 ||
          !evidenceId.trim()
        )
          throw new AccountError("invalid_migration", 400);
        const source = `free-migration:${evidenceId}`;
        if (
          (
            await tx.execute({
              sql: "SELECT 1 FROM cc_grants WHERE source=? AND account_id=?",
              args: [source, id],
            })
          ).rows.length
        )
          return;
        if (
          (
            await tx.execute({
              sql: "SELECT 1 FROM cc_accounts WHERE id=?",
              args: [id],
            })
          ).rows.length
        )
          throw new AccountError("migration_already_started");
        await tx.execute({
          sql: "INSERT INTO cc_accounts(id,free) VALUES (?,?)",
          args: [id, remaining],
        });
        await tx.execute({
          sql: "INSERT INTO cc_grants VALUES (?,?,0,?)",
          args: [source, id, clock()],
        });
      });
    },
    async cleanup() {
      return write(expire);
    },
  };
}
