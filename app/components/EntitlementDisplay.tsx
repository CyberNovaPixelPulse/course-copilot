"use client";
import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useSyncExternalStore,
} from "react";
import { signIn, useSession } from "next-auth/react";
import { createBrowserEntitlementDisplay } from "@/lib/entitlement-browser";
import type { createEntitlementDisplay } from "@/lib/entitlement-display";
import { useI18n } from "@/lib/i18n";
type Store = ReturnType<typeof createEntitlementDisplay>;
const Context = createContext<Store | null>(null);
export function EntitlementDisplayProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  const { data: session, status } = useSession();
  const accountId =
    status === "authenticated"
      ? session?.user?.id || session?.user?.email || ""
      : "";
  const browser = useMemo(
    () => createBrowserEntitlementDisplay(accountId),
    [accountId],
  );
  useEffect(() => {
    let cancel: (() => void) | undefined;
    let active = true;
    queueMicrotask(() => {
      if (active) cancel = browser.connect();
    });
    return () => {
      active = false;
      cancel?.();
    };
  }, [browser]);
  return <Context.Provider value={browser.store}>{children}</Context.Provider>;
}
export function useEntitlements() {
  const store = useContext(Context);
  if (!store) throw new Error("Entitlement display provider required");
  const state = useSyncExternalStore(
    store.subscribe,
    store.getSnapshot,
    store.getSnapshot,
  );
  return { store, state };
}
export function EntitlementStatus({ compact = false }: { compact?: boolean }) {
  const { state, store } = useEntitlements();
  const { status: sessionStatus } = useSession();
  const { locale } = useI18n();
  const zh = locale.startsWith("zh");
  const text = (cn: string, en: string) => (zh ? cn : en);
  const status = sessionStatus === "loading" ? "loading" : state.status;
  const message =
    status === "ready"
      ? ""
      : status === "sign-in"
        ? text("請重新登入以確認權益", "Sign in to confirm benefits")
        : status === "error"
          ? compact
            ? text("更新失敗", "Update failed")
            : state.snapshot
              ? text(
                  "更新失敗，目前顯示上次確認結果",
                  "Update failed. Showing the last confirmed result.",
                )
              : text(
                  "暫時無法確認權益",
                  "Account benefits are temporarily unavailable",
                )
          : text(
              status === "loading" ? "權益載入中" : "權益更新中",
              status === "loading" ? "Loading benefits" : "Updating benefits",
            );
  if (!message) return null;
  const Tag = compact ? "span" : "div";
  return (
    <Tag
      className={
        compact ? "text-xs text-stone-500" : "my-3 text-sm text-stone-600"
      }
      role="status"
      aria-label={text(
        compact ? "導覽權益狀態" : "帳號權益狀態",
        compact ? "Navigation benefit status" : "Account benefit status",
      )}
    >
      <span>{message}</span>
      {!compact && status === "error" && (
        <button
          type="button"
          className="ml-3 underline"
          onClick={() => void store.refresh()}
        >
          {text("重新查詢權益", "Retry benefits")}
        </button>
      )}
      {!compact && status === "sign-in" && (
        <button
          type="button"
          className="ml-3 underline"
          onClick={() =>
            void signIn("google", { callbackUrl: window.location.href })
          }
        >
          {text("登入", "Sign in")}
        </button>
      )}
    </Tag>
  );
}
