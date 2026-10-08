import { PLAN_PRICE_TWD } from "@/lib/entitlement";

export const BASE_PRICE_LABEL = "NT$9";
export const ECPAY_TWD_NOTE = "以新台幣 NT$9 結帳";

export type CurrencyCode = "TWD" | "USD" | "JPY" | "KRW" | "EUR";

const EUR_LANGUAGES = new Set(["es", "fr", "de", "it"]);
const ZERO_DECIMAL = new Set<CurrencyCode>(["TWD", "JPY", "KRW"]);
const TRACKED = ["USD", "JPY", "KRW", "EUR", "TWD"] as const;

const STRIPE_MINIMUM: Record<CurrencyCode, number> = {
  TWD: 1,
  USD: 0.5,
  EUR: 0.5,
  JPY: 50,
  KRW: 100,
};

const APPROX: Record<string, string> = {
  ja: "約",
  ko: "약",
  es: "aprox.",
  fr: "environ",
  de: "ca.",
  it: "circa",
  zh: "約",
};

const MIN_CACHE_MS = 60 * 60 * 1000;
const MAX_CACHE_MS = 12 * 60 * 60 * 1000;
const DEFAULT_CACHE_MS = 6 * 60 * 60 * 1000;
const CLIENT_CACHE_KEY = "cc_fx_twd_v1";
const RATE_URL = "https://open.er-api.com/v6/latest/TWD";

export type RateSnapshot = {
  rates: Record<string, number>;
  expiresAt: number;
};

export type PlanQuote = {
  currency: CurrencyCode;
  amount: number;
  unitAmount: number;
  label: string;
  note?: string;
};

let memory: RateSnapshot | null = null;

function language(locale: string): string {
  return locale.trim().replace(/_/g, "-").toLowerCase().split("-")[0] ?? "";
}

export function currencyForLocale(locale: string): CurrencyCode {
  const primary = language(locale);
  if (primary === "zh") return "TWD";
  if (primary === "en") return "USD";
  if (primary === "ja") return "JPY";
  if (primary === "ko") return "KRW";
  if (EUR_LANGUAGES.has(primary)) return "EUR";
  return "USD";
}

export function convertFromTwd(twd: number, currency: CurrencyCode, rate: number): number {
  if (currency === "TWD") return Math.round(twd);
  const raw = twd * rate;
  if (ZERO_DECIMAL.has(currency)) return Math.round(raw);
  return Math.round(raw * 100) / 100;
}

export function stripeUnitAmount(amount: number, currency: CurrencyCode): number {
  if (ZERO_DECIMAL.has(currency)) return Math.round(amount);
  return Math.round(amount * 100);
}

export function formatPlanPrice(
  locale: string,
  rates: Record<string, number> | null | undefined,
  currencyOverride?: CurrencyCode | null,
): string {
  const currency = currencyOverride ?? currencyForLocale(locale);
  if (currency === "TWD") return BASE_PRICE_LABEL;
  const rate = rates?.[currency];
  if (!rate || !Number.isFinite(rate) || rate <= 0) return BASE_PRICE_LABEL;
  const amount = convertFromTwd(PLAN_PRICE_TWD, currency, rate);
  if (amount < STRIPE_MINIMUM[currency]) return BASE_PRICE_LABEL;
  const digits = ZERO_DECIMAL.has(currency) ? 0 : 2;
  const local = new Intl.NumberFormat("en-US", {
    style: "currency",
    currency,
    currencyDisplay: "narrowSymbol",
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  }).format(amount);
  const approx = APPROX[language(locale)] ?? "about";
  return `${approx} ${local} ${currency} (${BASE_PRICE_LABEL})`;
}

export function twdQuote(note?: string): PlanQuote {
  return {
    currency: "TWD",
    amount: PLAN_PRICE_TWD,
    unitAmount: PLAN_PRICE_TWD,
    label: BASE_PRICE_LABEL,
    note,
  };
}

export function quoteFromRates(
  locale: string,
  rates: Record<string, number> | null | undefined,
): PlanQuote {
  const currency = currencyForLocale(locale);
  if (currency === "TWD") return twdQuote();
  const rate = rates?.[currency];
  if (!rate || !Number.isFinite(rate) || rate <= 0) return twdQuote();
  const amount = convertFromTwd(PLAN_PRICE_TWD, currency, rate);
  if (amount < STRIPE_MINIMUM[currency]) return twdQuote();
  return {
    currency,
    amount,
    unitAmount: stripeUnitAmount(amount, currency),
    label: formatPlanPrice(locale, rates),
  };
}

function clampTtl(nextUpdateUnix?: number): number {
  if (!nextUpdateUnix) return DEFAULT_CACHE_MS;
  const ms = nextUpdateUnix * 1000 - Date.now();
  if (!Number.isFinite(ms)) return DEFAULT_CACHE_MS;
  return Math.min(MAX_CACHE_MS, Math.max(MIN_CACHE_MS, ms));
}

function readFresh(): RateSnapshot | null {
  if (memory && memory.expiresAt > Date.now()) return memory;
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(CLIENT_CACHE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as RateSnapshot;
    if (!parsed?.rates || parsed.expiresAt <= Date.now()) return null;
    memory = parsed;
    return parsed;
  } catch {
    return null;
  }
}

function remember(snapshot: RateSnapshot) {
  memory = snapshot;
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(CLIENT_CACHE_KEY, JSON.stringify(snapshot));
  } catch {
    /* Ignore private mode or a full storage quota. */
  }
}

export async function getRateSnapshot(): Promise<RateSnapshot> {
  const fresh = readFresh();
  if (fresh) return fresh;

  const response = await fetch(RATE_URL, { cache: "no-store" });
  if (!response.ok) throw new Error("Exchange rate request failed.");
  const data = (await response.json()) as {
    result?: string;
    rates?: Record<string, number>;
    time_next_update_unix?: number;
  };
  if (data.result !== "success" || !data.rates) {
    throw new Error("Exchange rate payload was invalid.");
  }

  const rates: Record<string, number> = {};
  for (const code of TRACKED) {
    const value = data.rates[code];
    if (typeof value === "number" && Number.isFinite(value) && value > 0) {
      rates[code] = value;
    }
  }
  if (!rates.USD || !rates.JPY || !rates.KRW || !rates.EUR) {
    throw new Error("Exchange rate payload was missing a currency.");
  }

  const snapshot = {
    rates,
    expiresAt: Date.now() + clampTtl(data.time_next_update_unix),
  };
  remember(snapshot);
  return snapshot;
}

export async function loadClientRates(): Promise<Record<string, number> | null> {
  const fresh = readFresh();
  if (fresh) return fresh.rates;
  try {
    const response = await fetch("/api/rates", { cache: "no-store" });
    if (!response.ok) return null;
    const data = (await response.json()) as RateSnapshot;
    if (!data?.rates || typeof data.expiresAt !== "number") return null;
    remember(data);
    return data.rates;
  } catch {
    return null;
  }
}
