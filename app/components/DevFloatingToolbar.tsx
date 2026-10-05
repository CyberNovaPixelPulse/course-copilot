"use client";

import { useEffect, useState } from "react";
import type { CurrencyCode } from "@/lib/currency";

const USAGE_UPDATED_EVENT = "cc-usage-updated";
const CURRENCY_EVENT = "cc-dev-currency";
const STORAGE_KEY = "cc_entitlement_token";
const CURRENCY_KEY = "cc_dev_currency";

const CURRENCIES = ["TWD", "USD", "JPY", "EUR"] as const;

type DevAction = "paid" | "unpaid" | "add" | "zero";

export default function DevFloatingToolbar() {
  const [open, setOpen] = useState(true);
  const [busy, setBusy] = useState(false);
  const [currency, setCurrency] = useState<CurrencyCode | "">("");
  const [message, setMessage] = useState("");

  useEffect(() => {
    const stored = window.localStorage.getItem(CURRENCY_KEY);
    if (stored === "TWD" || stored === "USD" || stored === "JPY" || stored === "EUR") {
      setCurrency(stored);
    }
  }, []);

  if (process.env.NODE_ENV !== "development") return null;

  async function run(action: DevAction) {
    setBusy(true);
    setMessage("");
    try {
      const token = window.localStorage.getItem(STORAGE_KEY);
      const response = await fetch("/api/dev/entitlement", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(token ? { "x-cc-token": token } : {}),
        },
        body: JSON.stringify({ action }),
      });
      const data = (await response.json()) as {
        error?: string;
        token?: string;
        paid?: boolean;
        gpt4oRemaining?: number;
        freeScansRemaining?: number;
        usage?: {
          token?: string;
          paid?: boolean;
          gpt4oRemaining?: number;
          freeScansRemaining?: number;
        };
      };
      if (!response.ok) throw new Error(data.error || "Dev action failed.");
      const usage = data.usage ?? data;
      if (usage.token) window.localStorage.setItem(STORAGE_KEY, usage.token);
      window.dispatchEvent(new CustomEvent(USAGE_UPDATED_EVENT, { detail: usage }));
      const count = usage.paid ? usage.gpt4oRemaining : usage.freeScansRemaining;
      setMessage(usage.paid ? `已付費 · ${count} 次` : `未付費 · ${count} 次`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Dev action failed.");
    } finally {
      setBusy(false);
    }
  }

  function previewCurrency(next: CurrencyCode | "") {
    setCurrency(next);
    if (next) window.localStorage.setItem(CURRENCY_KEY, next);
    else window.localStorage.removeItem(CURRENCY_KEY);
    window.dispatchEvent(new CustomEvent(CURRENCY_EVENT, { detail: next || null }));
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
          <button
            type="button"
            disabled={busy}
            onClick={() => void run("paid")}
            className="rounded-full bg-amber-900 px-3 py-2 text-left text-xs font-medium text-amber-50 disabled:opacity-60"
          >
            切換為已付費狀態 (VIP 解鎖)
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={() => void run("unpaid")}
            className="rounded-full border border-amber-400 bg-white px-3 py-2 text-left text-xs font-medium disabled:opacity-60"
          >
            重設為未付費狀態
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={() => void run("add")}
            className="rounded-full border border-amber-400 bg-white px-3 py-2 text-left text-xs font-medium disabled:opacity-60"
          >
            次數充值 +10 次
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={() => void run("zero")}
            className="rounded-full border border-amber-400 bg-white px-3 py-2 text-left text-xs font-medium disabled:opacity-60"
          >
            次數歸零 (0 次)
          </button>
          <label className="flex flex-col gap-1 text-xs font-medium">
            切換幣別預覽
            <select
              value={currency}
              onChange={(event) => previewCurrency(event.target.value as CurrencyCode | "")}
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
          {message ? <p className="text-[11px] leading-4 text-amber-800">{message}</p> : null}
        </div>
      ) : null}
    </aside>
  );
}
