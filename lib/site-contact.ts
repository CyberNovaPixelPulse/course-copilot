/** Seller contact shown in the homepage footer. Override via env for ECPay review. */
export const supportEmail =
  process.env.NEXT_PUBLIC_SUPPORT_EMAIL?.trim() || "support@necterelux.com";

export const supportPhone =
  process.env.NEXT_PUBLIC_SUPPORT_PHONE?.trim() || "09xxxxxxxx";
