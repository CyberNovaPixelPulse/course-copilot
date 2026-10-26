"use client";

import { useEffect, useRef, useState } from "react";
import { useEntitlements } from "./EntitlementDisplay";
import { signIn } from "next-auth/react";
import { createBrowserCheckout } from "@/lib/checkout-browser";
import type {
  CheckoutDraft,
  CheckoutState,
  PaymentProvider,
} from "@/lib/checkout-recovery";
import type { Course } from "@/lib/types";

type Flow = ReturnType<typeof createBrowserCheckout>;
export function useCheckoutRecovery(accountId: string) {
  const flow = useRef<Flow | null>(null);
  const [state, setState] = useState<CheckoutState>({
    payment: "idle",
    starting: null,
    problem: null,
  });
  const [drafts, setDrafts] = useState<CheckoutDraft[]>([]);
  const { store: entitlementStore } = useEntitlements();
  const refreshRef = useRef<() => void>(() => {});
  useEffect(() => {
    let active = true;
    let operation:
      ReturnType<typeof entitlementStore.beginOperation> | undefined;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const controller = createBrowserCheckout(accountId, (next) => {
      if (!active) return;
      setState(next);
      if (next.payment === "checking" && !operation)
        operation = entitlementStore.beginOperation();
      if (operation && next.payment !== "checking") {
        void operation.finish(
          next.usage,
          next.payment === "sign-in"
            ? 401
            : next.payment === "wrong-account"
              ? 403
              : next.payment === "unavailable"
                ? 0
                : 200,
        );
        operation = undefined;
      }
    });
    flow.current = controller;
    const refresh = () => {
      if (!active) return;
      const next = controller.listDrafts();
      setDrafts(next);
      clearTimeout(timer);
      if (next.length)
        timer = setTimeout(
          refresh,
          Math.max(1, Math.min(...next.map((d) => d.expiresAt)) - Date.now()),
        );
    };
    refreshRef.current = refresh;
    queueMicrotask(() => {
      if (!active) return;
      refresh();
      void controller.handleReturn(window.location.search).finally(refresh);
    });
    window.addEventListener("storage", refresh);
    window.addEventListener("focus", refresh);
    return () => {
      active = false;
      controller.dispose();
      void operation?.finish(undefined, 0);
      if (flow.current === controller) flow.current = null;
      clearTimeout(timer);
      window.removeEventListener("storage", refresh);
      window.removeEventListener("focus", refresh);
    };
  }, [accountId, entitlementStore]);
  async function start(
    provider: PaymentProvider,
    courses: Course[],
    locale: string,
    skipSave = false,
  ) {
    if (!accountId) {
      await signIn("google", { callbackUrl: window.location.href });
      return;
    }
    const controller = flow.current;
    if (!controller) return;
    await controller.start(provider, courses, locale, skipSave);
    if (controller === flow.current) refreshRef.current();
  }
  return {
    state,
    drafts,
    start,
    flow,
    refreshDrafts: () => refreshRef.current(),
  };
}

export default function CheckoutRecovery({
  checkout,
  courses,
  locale,
  onRestore,
}: {
  checkout: ReturnType<typeof useCheckoutRecovery>;
  courses: Course[];
  locale: string;
  onRestore: (courses: Course[]) => void;
}) {
  const zh = locale.startsWith("zh");
  const { state, drafts, flow } = checkout;
  const text = (cn: string, en: string) => (zh ? cn : en);
  const paymentMessages: Record<CheckoutState["payment"], string> = {
    idle: "",
    checking: text("正在確認付款…", "Confirming payment…"),
    paid: text(
      "付款已確認，帳號權益已更新。",
      "Payment confirmed. Account benefits updated.",
    ),
    pending: text(
      "付款尚待確認。若已付款，無須再次付款。",
      "Payment confirmation is pending. If you paid, do not pay again.",
    ),
    unavailable: text(
      "暫時無法確認付款，請稍後重新查詢。若已付款，無須再次付款。",
      "Unable to confirm payment temporarily. Retry later without paying again.",
    ),
    "wrong-account": text(
      "請改用付款時的帳號登入，再接續確認與恢復。",
      "Sign in with the account used for payment to continue.",
    ),
    "sign-in": text(
      "請先登入付款時的帳號，再接續確認與恢復。",
      "Sign in with the payment account to continue.",
    ),
  };
  const problems: Record<NonNullable<CheckoutState["problem"]>, string> = {
    save: text(
      "無法保存付款前課表，已留在此頁保留目前內容。請重試付款，或明確選擇不保存。",
      "Could not save your checkout draft. Your current schedule is still here. Retry checkout or explicitly continue without saving.",
    ),
    create: text(
      "付款未能開始，可能尚未取得付款資訊。已保存的課表仍可恢復；系統不會自動重試。",
      "Checkout could not start; payment information may be unavailable. Saved drafts remain recoverable. No automatic retry.",
    ),
    storage: text(
      "暫時無法讀取或更新瀏覽器備份。付款確認仍可進行。",
      "Browser drafts are temporarily unavailable. Payment confirmation can continue.",
    ),
    draft: text(
      "部分備份損壞或格式無法讀取，無法恢復；其他備份與付款確認仍可使用。可在「最近辨識」另選原始結果，但不包含付款前手動修改。",
      "Some drafts cannot be read or restored. Other drafts and payment confirmation remain available. Recent recognition offers original results without checkout edits.",
    ),
  };
  const retryable = ["pending", "unavailable"].includes(state.payment);
  if (!drafts.length && state.payment === "idle" && !state.problem) return null;
  return (
    <section
      aria-label={text("付款與課表恢復", "Payment and schedule recovery")}
      className="my-4 rounded-xl border border-stone-200 p-4 text-sm"
    >
      <h3 className="font-semibold">
        {text("付款與課表恢復", "Payment and schedule recovery")}
      </h3>
      {state.payment !== "idle" && (
        <p role="status" className="mt-2">
          {paymentMessages[state.payment]}
        </p>
      )}
      {retryable && (
        <button
          type="button"
          className="mt-2 underline"
          onClick={() => void flow.current?.recheck()}
        >
          {text("重新查詢付款", "Check payment again")}
        </button>
      )}
      {["sign-in", "wrong-account"].includes(state.payment) && (
        <button
          type="button"
          className="mt-2 underline"
          onClick={() =>
            void signIn("google", { callbackUrl: window.location.href })
          }
        >
          {text("登入付款帳號", "Sign in with payment account")}
        </button>
      )}
      {state.problem && (
        <p role="alert" className="mt-2 text-amber-700">
          {problems[state.problem]}
        </p>
      )}
      {drafts.length > 0 && (
        <>
          <p className="mt-3 text-stone-500">
            {text(
              "付款前課表僅保存在此瀏覽器，保存七天；清除瀏覽器資料後可能無法恢復。",
              "Checkout drafts stay in this browser for seven days. Clearing browser data may remove them.",
            )}
          </p>
          <ul className="mt-2 space-y-3">
            {[...drafts]
              .sort(
                (a, b) =>
                  Number(b.id === state.preferredDraftId) -
                  Number(a.id === state.preferredDraftId),
              )
              .map((draft) => (
                <li key={draft.id} className="rounded-lg bg-stone-50 p-3">
                  <p className="font-medium">
                    {draft.provider === "ecpay" ? "ECPay" : "Stripe"}
                    {draft.id === state.preferredDraftId
                      ? text(" · 本次付款的課表", " · This payment’s draft")
                      : ""}
                  </p>
                  <p>
                    {text("保存：", "Saved: ")}
                    {new Date(draft.savedAt).toLocaleString(locale)}
                  </p>
                  <p>
                    {text("到期：", "Expires: ")}
                    {new Date(draft.expiresAt).toLocaleString(locale)}
                  </p>
                  {!draft.paymentId && (
                    <p>
                      {text(
                        "尚未取得付款資訊",
                        "Payment information not yet available",
                      )}
                    </p>
                  )}
                  <div className="mt-2 flex gap-4">
                    <button
                      type="button"
                      className="underline"
                      onClick={() => {
                        const controller = flow.current;
                        if (!controller) return;
                        let result = controller.restore(
                          draft.id,
                          courses.length > 0,
                        );
                        if (
                          result.status === "needs-confirmation" &&
                          window.confirm(
                            text(
                              "恢復將取代目前課表，確定繼續？",
                              "Restoring will replace your current schedule. Continue?",
                            ),
                          )
                        )
                          result = controller.restore(draft.id, true, true);
                        if (result.courses) onRestore(result.courses);
                      }}
                    >
                      {text("恢復付款前課表", "Restore checkout draft")}
                    </button>
                    <button
                      type="button"
                      className="underline"
                      onClick={() => {
                        if (
                          window.confirm(
                            text(
                              "確定捨棄這份付款前課表？",
                              "Discard this checkout draft?",
                            ),
                          )
                        ) {
                          flow.current?.discard(draft.id);
                          checkout.refreshDrafts();
                        }
                      }}
                    >
                      {text("捨棄", "Discard")}
                    </button>
                  </div>
                </li>
              ))}
          </ul>
        </>
      )}
    </section>
  );
}
