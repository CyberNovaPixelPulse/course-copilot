const PROMO_CODES = new Set(["TESTVIP", "FRIENDS2026"]);

export function normalizePromoCode(code: string) {
  return code.trim().toUpperCase();
}

export function isPromoCode(code: string) {
  return PROMO_CODES.has(code);
}
