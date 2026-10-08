import { createHash } from "node:crypto";

export const ECPAY_STAGE_URL = "https://payment-stage.ecpay.com.tw/Cashier/AioCheckOut/V5";
export const ECPAY_PRODUCTION_URL = "https://payment.ecpay.com.tw/Cashier/AioCheckOut/V5";

const STAGE_KEYS = {
  merchantId: "2000132",
  hashKey: "5294y06JbISpM5x9",
  hashIv: "v77hoKGq4kWxQIS9",
};

export function isEcpayStageUrl(url: string) {
  return url.startsWith("https://payment-stage.ecpay.com.tw/");
}

export function ecpayActionUrl() {
  const requested = (process.env.ECPAY_ENV || process.env.ECPAY_CHECKOUT_URL || "").trim();
  const lowered = requested.toLowerCase();
  if (lowered === "stage" || lowered === "test" || isEcpayStageUrl(requested)) {
    return ECPAY_STAGE_URL;
  }
  return ECPAY_PRODUCTION_URL;
}

/** Stage URL always uses the official test keys. Production URL reads process.env. */
export function credentialsForAction(actionUrl: string) {
  if (isEcpayStageUrl(actionUrl)) return { ...STAGE_KEYS };
  const merchantId = process.env.ECPAY_MERCHANT_ID?.trim() ?? "";
  const hashKey = process.env.ECPAY_HASH_KEY?.trim() ?? "";
  const hashIv = process.env.ECPAY_HASH_IV?.trim() ?? "";
  if (!merchantId || !hashKey || !hashIv) return null;
  return { merchantId, hashKey, hashIv };
}

export function merchantTradeDate(now = new Date()) {
  const taipei = new Date(now.getTime() + 8 * 60 * 60 * 1000);
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${taipei.getUTCFullYear()}/${pad(taipei.getUTCMonth() + 1)}/${pad(taipei.getUTCDate())} ${pad(taipei.getUTCHours())}:${pad(taipei.getUTCMinutes())}:${pad(taipei.getUTCSeconds())}`;
}

export function merchantTradeNo() {
  return `EC${Date.now().toString().slice(-8)}${Math.floor(Math.random() * 1000)}`;
}

export function checkMacValue(params: Record<string, string>, hashKey: string, hashIv: string) {
  const paramString = Object.keys(params)
    .filter((key) => key !== "CheckMacValue")
    .sort((a, b) => (a < b ? -1 : a > b ? 1 : 0))
    .map((key) => `${key}=${params[key]}`)
    .join("&");
  const source = `HashKey=${hashKey}&${paramString}&HashIV=${hashIv}`;
  const encoded = encodeURIComponent(source)
    .replace(/%20/g, "+")
    .replace(/%21/g, "!")
    .replace(/%28/g, "(")
    .replace(/%29/g, ")")
    .replace(/%2a/gi, "*")
    .replace(/%2d/gi, "-")
    .replace(/%2e/gi, ".")
    .replace(/%5f/gi, "_")
    .toLowerCase();
  return createHash("sha256").update(encoded).digest("hex").toUpperCase();
}

export function ecpayAutoSubmitHtml(action: string, params: Record<string, string>) {
  const inputs = Object.entries(params)
    .map(([key, value]) => {
      const safe = value.replaceAll("&", "&amp;").replaceAll('"', "&quot;").replaceAll("<", "&lt;");
      return `<input type="hidden" name="${key}" value="${safe}" />`;
    })
    .join("");
  return `<!DOCTYPE html><html lang="zh-Hant"><head><meta charset="utf-8" /><title>ECPay</title></head><body><form id="ecpay" method="post" action="${action}">${inputs}</form><script>document.getElementById("ecpay").submit();</script></body></html>`;
}
