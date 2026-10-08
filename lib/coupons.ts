import { randomUUID } from "crypto";
import { getTurso } from "@/lib/turso";

export const COUPON_SITE_ID = "course-copilot";

/** Hardcoded unlock codes. Add a code here to enable it without a database row. */
export const ACTIVE_COUPONS: readonly string[] = [];

export type CouponRejection = "inactive" | "limit" | "expired";

export type CouponRecord = {
  id: string;
  code: string;
  discountType: string;
  discountValue: number;
  maxUses: number;
  usedCount: number;
  expiresAt: string | null;
};

export type RedeemedCoupon = {
  code: string;
  discountType: string;
  discountValue: number;
};

const REJECTION_MESSAGE: Record<CouponRejection, string> = {
  inactive: "優惠碼無效或已被使用",
  limit: "優惠碼無效或已被使用",
  expired: "優惠碼已過期",
};

const LISTED_CODES = new Set(ACTIVE_COUPONS.map((code) => code.trim().toUpperCase()).filter(Boolean));

export function normalizeCouponCode(value: string) {
  return value.trim().toUpperCase();
}

export function isListedCoupon(code: string) {
  return LISTED_CODES.has(normalizeCouponCode(code));
}

export function couponRejectionMessage(reason: CouponRejection) {
  return REJECTION_MESSAGE[reason];
}

function asNumber(value: unknown, fallback: number) {
  if (typeof value === "bigint") return Number(value);
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() && Number.isFinite(Number(value))) {
    return Number(value);
  }
  return fallback;
}

function asText(value: unknown) {
  if (typeof value === "string") return value;
  if (value == null) return "";
  return String(value);
}

export function isCouponExpired(expiresAt: string | null, now = Date.now()) {
  if (!expiresAt?.trim()) return false;
  const raw = expiresAt.trim();
  const hasZone = /[zZ]$|[+-]\d{2}:?\d{2}$/.test(raw);
  const time = Date.parse(hasZone ? raw : `${raw.replace(" ", "T")}Z`);
  if (Number.isNaN(time)) return false;
  return time <= now;
}

export async function findActiveCoupon(code: string): Promise<CouponRecord | null> {
  const normalized = normalizeCouponCode(code);
  if (!normalized) return null;
  const result = await getTurso().execute({
    sql: `SELECT * FROM coupons WHERE upper(code) = ? AND site_id = 'course-copilot' AND is_active = 1`,
    args: [normalized],
  });
  const row = result.rows[0];
  if (!row) return null;
  const id = asText(row.id).trim();
  if (!id) return null;
  return {
    id,
    code: asText(row.code).trim(),
    discountType: asText(row.discount_type).trim().toLowerCase(),
    discountValue: asNumber(row.discount_value, 0),
    maxUses: asNumber(row.max_uses, -1),
    usedCount: asNumber(row.used_count, 0),
    expiresAt: row.expires_at == null || row.expires_at === "" ? null : asText(row.expires_at),
  };
}

export function rejectCoupon(coupon: CouponRecord, now = Date.now()): CouponRejection | null {
  if (coupon.maxUses !== -1 && coupon.usedCount >= coupon.maxUses) return "limit";
  if (isCouponExpired(coupon.expiresAt, now)) return "expired";
  return null;
}

export async function incrementCouponUse(id: string) {
  const result = await getTurso().execute({
    sql: `UPDATE coupons SET used_count = used_count + 1 WHERE id = ?`,
    args: [id],
  });
  return result.rowsAffected > 0;
}

async function insertListedCoupon(code: string) {
  await getTurso().execute({
    sql: `INSERT INTO coupons (id, code, site_id, discount_type, discount_value, max_uses, used_count, is_active)
          SELECT ?, ?, 'course-copilot', 'percent', 100, 1, 0, 1
          WHERE NOT EXISTS (
            SELECT 1 FROM coupons WHERE site_id = 'course-copilot' AND upper(code) = ?
          )`,
    args: [randomUUID(), code, code],
  });
}

/** Claims one global use of a code listed in ACTIVE_COUPONS. */
async function claimListedCoupon(code: string) {
  await insertListedCoupon(code);
  const result = await getTurso().execute({
    sql: `UPDATE coupons
          SET used_count = used_count + 1, is_active = 0
          WHERE site_id = 'course-copilot' AND upper(code) = ? AND is_active = 1 AND used_count < 1`,
    args: [code],
  });
  return result.rowsAffected > 0;
}

export async function redeemCoupon(
  code: string,
): Promise<RedeemedCoupon | { reason: CouponRejection }> {
  const normalized = normalizeCouponCode(code);
  if (!normalized) return { reason: "inactive" };

  if (isListedCoupon(normalized)) {
    const claimed = await claimListedCoupon(normalized);
    return claimed
      ? { code: normalized, discountType: "percent", discountValue: 100 }
      : { reason: "limit" };
  }

  const coupon = await findActiveCoupon(normalized);
  if (!coupon) return { reason: "inactive" };
  if (coupon.discountType === "credits" && !(coupon.discountValue > 0)) {
    return { reason: "inactive" };
  }
  const reason = rejectCoupon(coupon);
  if (reason) return { reason };
  const claimed = await incrementCouponUse(coupon.id);
  if (!claimed) return { reason: "limit" };
  return {
    code: normalizeCouponCode(coupon.code) || normalized,
    discountType: coupon.discountType,
    discountValue: coupon.discountValue,
  };
}
