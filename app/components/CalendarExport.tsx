"use client";
import { useEffect, useMemo, useSyncExternalStore } from "react";
import { signIn } from "next-auth/react";
import { createBrowserCalendarExport } from "@/lib/calendar-export-browser";
import { SHARE_URL } from "@/lib/shareCard";
import type { createCalendarExport } from "@/lib/calendar-export";
import type { Course } from "@/lib/types";
import { useEntitlements } from "./EntitlementDisplay";
import { useI18n } from "@/lib/i18n";
export type CalendarExportController = ReturnType<typeof createCalendarExport>;
export function useCalendarExport(accountId: string, onPayment: () => void) {
  const { store } = useEntitlements(),
    { t } = useI18n();
  const flow = useMemo(
    () =>
      createBrowserCalendarExport(accountId, {
        access: (kind) => {
          if (kind === "auth") {
            store.requireSignIn();
            void signIn("google", { callbackUrl: "/#upload" }).catch(() => {});
          } else onPayment();
        },
      }),
    [accountId, onPayment, store],
  );
  useEffect(
    () =>
      flow.setImageLabels({
        heading: t.upload.shareCardHeading ?? "This semester",
        footer: t.upload.shareCardFooter ?? SHARE_URL,
        weekdays: t.calendar.weekdays,
      }),
    [flow, t],
  );
  const state = useSyncExternalStore(
    flow.subscribe,
    flow.getSnapshot,
    flow.getSnapshot,
  );
  useEffect(() => {
    flow.connect();
    const leave = () => flow.dispose();
    window.addEventListener("pagehide", leave);
    window.addEventListener("pageshow", flow.connect);
    return () => {
      window.removeEventListener("pagehide", leave);
      window.removeEventListener("pageshow", flow.connect);
      flow.dispose();
    };
  }, [flow]);
  return { flow, state };
}
export default function CalendarExportStatus({
  flow,
  courses,
}: {
  flow: CalendarExportController;
  courses: Course[];
}) {
  const state = useSyncExternalStore(
      flow.subscribe,
      flow.getSnapshot,
      flow.getSnapshot,
    ),
    { locale } = useI18n();
  const text = (zh: string, en: string) => (locale.startsWith("zh") ? zh : en);
  if (state.phase === "idle") return null;
  const changed = state.snapshot && !flow.matches(courses);
  return (
    <section
      aria-label="行事曆匯出"
      className="my-4 rounded-2xl border border-indigo-200 bg-indigo-50 p-4 text-sm"
    >
      <p role="status">
        {state.phase === "preparing"
          ? text("正在準備行事曆檔案…", "Preparing calendar…")
          : state.result
            ? text("行事曆檔案已準備好", "Calendar file is ready")
            : text("行事曆尚未準備完成", "Calendar is not ready")}
      </p>
      {changed ? (
        <p>
          {text(
            "這次匯出對應先前的課表版本。",
            "This export uses an earlier schedule version.",
          )}
        </p>
      ) : null}
      {state.problem ? <p role="alert">{state.problem.message}</p> : null}
      <div className="mt-2 flex flex-wrap gap-3">
        {state.phase === "error" &&
        state.snapshot &&
        state.problem?.kind !== "invalid" ? (
          <button
            type="button"
            className="underline"
            onClick={() => void flow.retry()}
          >
            {text("重試準備", "Retry preparation")}
          </button>
        ) : null}
        {state.result ? (
          <button type="button" className="underline" onClick={flow.reopen}>
            {text("查看這次匯出結果", "View this export")}
          </button>
        ) : null}
        <button
          type="button"
          className="underline disabled:opacity-50"
          disabled={state.phase === "preparing" && flow.matches(courses)}
          onClick={() => void flow.start(courses, true)}
        >
          {text("改用目前課表重新匯出", "Export the current schedule")}
        </button>
      </div>
    </section>
  );
}
