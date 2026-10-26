"use client";

import { useEffect, useState } from "react";
import type { CurrencyCode } from "@/lib/currency";

const CURRENCY_EVENT = "cc-dev-currency";
const CURRENCY_KEY = "cc_dev_currency";

const CURRENCIES = ["TWD", "USD", "JPY", "EUR"] as const;

export default function DevFloatingToolbar() {
  const [open, setOpen] = useState(true);
  const [currency, setCurrency] = useState<CurrencyCode | "">("");

  useEffect(() => {
    const stored = window.localStorage.getItem(CURRENCY_KEY);
    if (
      stored === "TWD" ||
      stored === "USD" ||
      stored === "JPY" ||
      stored === "EUR"
    ) {
      queueMicrotask(() => setCurrency(stored));
    }
  }, []);

  if (process.env.NODE_ENV !== "development") return null;

  function previewCurrency(next: CurrencyCode | "") {
    setCurrency(next);
    if (next) window.localStorage.setItem(CURRENCY_KEY, next);
    else window.localStorage.removeItem(CURRENCY_KEY);
    window.dispatchEvent(
      new CustomEvent(CURRENCY_EVENT, { detail: next || null }),
    );
  }

  return (
    <aside className="fixed bottom-4 left-4 z-[70] w-[min(18rem,calc(100vw-2rem))] rounded-2xl border border-dashed border-amber-400 bg-amber-50 text-amber-950 shadow-lg">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        className="flex w-full items-center justify-between px-3 py-2 text-left text-xs font-semibold"
        aria-expanded={open}
      >
        <span>DEV 測試工具</span>
        <span>{open ? "收合" : "展開"}</span>
      </button>
      {open ? (
        <div className="flex flex-col gap-2 px-3 pb-3">
          <label className="flex flex-col gap-1 text-xs font-medium">
            切換幣別預覽
            <select
              value={currency}
              onChange={(event) =>
                previewCurrency(event.target.value as CurrencyCode | "")
              }
              className="rounded-xl border border-amber-300 bg-white px-2 py-2 text-xs"
            >
              <option value="">跟隨語言</option>
              {CURRENCIES.map((code) => (
                <option key={code} value={code}>
                  {code}
                </option>
              ))}
            </select>
          </label>
        </div>
      ) : null}
    </aside>
  );
}
