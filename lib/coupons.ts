import { getTurso } from "@/lib/turso";

export const COUPON_SITE_ID = "course-copilot";

export type CouponRejection = "inactive" | "limit" | "expired";

export type CouponRecord = {
  id: string;
  code: string;
  maxUses: number;
  usedCount: number;
  expiresAt: string | null;
};

const REJECTION_MESSAGE: Record<CouponRejection, string> = {
  inactive: "優惠碼無效或已停用",
  limit: "優惠碼已達使用上限",
  expired: "優惠碼已過期",
};

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
  const result = await getTurso().execute({
    sql: `SELECT * FROM coupons WHERE code = ? AND site_id = 'course-copilot' AND is_active = 1`,
    args: [code],
  });
  const row = result.rows[0];
  if (!row) return null;
  const id = asText(row.id).trim();
  if (!id) return null;
  return {
    id,
    code: asText(row.code).trim(),
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
  await getTurso().execute({
    sql: `UPDATE coupons SET used_count = used_count + 1 WHERE id = ?`,
    args: [id],
  });
}
