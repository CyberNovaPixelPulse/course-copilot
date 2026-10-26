import type { Course } from "./types";
import { exportableCourses } from "./course-time";
export type DeliveryMethod = "download" | "apple";
export type PreparedResponse = {
  status: number;
  contentType: string;
  body: string;
};
export type ExportProblem = {
  kind: "invalid" | "auth" | "payment" | "prepare" | "delivery";
  message: string;
};
export type ExportState = {
  phase: "idle" | "preparing" | "ready" | "error";
  open: boolean;
  snapshot: Course[] | null;
  result: { accountId: string; courses: Course[]; ics: string } | null;
  problem: ExportProblem | null;
  delivery: DeliveryMethod | null;
  deliveryPending: boolean;
  image: {
    phase: "idle" | "preparing" | "ready" | "error";
    blob: Blob | null;
    message: string;
  };
};
export type ExportDependencies = {
  prepare: (
    courses: Course[],
    signal: AbortSignal,
  ) => Promise<PreparedResponse>;
  deliver: (ics: string, method: DeliveryMethod) => void | Promise<void>;
  renderImage: (courses: Course[]) => Promise<Blob>;
  access: (kind: "auth" | "payment") => void;
  setTimer: (callback: () => void, ms: number) => ReturnType<typeof setTimeout>;
  clearTimer: (id: ReturnType<typeof setTimeout>) => void;
};
const initial = (): ExportState => ({
  phase: "idle",
  open: false,
  snapshot: null,
  result: null,
  problem: null,
  delivery: null,
  deliveryPending: false,
  image: { phase: "idle", blob: null, message: "" },
});
export function createCalendarExport(
  accountId: string,
  deps: ExportDependencies,
) {
  let state = initial(),
    active = true,
    generation = 0,
    imageGeneration = 0;
  let cancelRequest: (() => void) | undefined;
  const listeners = new Set<() => void>();
  const publish = (patch: Partial<ExportState>) => {
    state = { ...state, ...patch };
    listeners.forEach((fn) => fn());
  };
  const valid = (turn: number) => active && generation === turn;
  function invalidate() {
    generation++;
    cancelRequest?.();
    cancelRequest = undefined;
  }
  function matches(courses: Course[]) {
    if (!state.snapshot) return false;
    try {
      return (
        JSON.stringify(state.snapshot) ===
        JSON.stringify(exportableCourses(courses))
      );
    } catch {
      return false;
    }
  }
  async function retryImage() {
    if (!active || !state.result) return;
    const turn = generation,
      imageTurn = ++imageGeneration,
      courses = structuredClone(state.result.courses);
    publish({ image: { phase: "preparing", blob: null, message: "" } });
    try {
      const blob = await deps.renderImage(courses);
      if (valid(turn) && imageTurn === imageGeneration)
        publish({ image: { phase: "ready", blob, message: "" } });
    } catch {
      if (valid(turn) && imageTurn === imageGeneration)
        publish({
          image: {
            phase: "error",
            blob: null,
            message: "分享圖片產生失敗，請重試產生圖片",
          },
        });
    }
  }
  async function deliver(method: DeliveryMethod) {
    if (!active || !state.result || state.deliveryPending) return;
    const turn = generation,
      ics = state.result.ics;
    publish({ deliveryPending: true, problem: null, delivery: null });
    try {
      await deps.deliver(ics, method);
      if (valid(turn)) publish({ delivery: method });
    } catch {
      if (valid(turn))
        publish({
          problem: {
            kind: "delivery",
            message: "無法觸發交付，請重試或選擇下載 ICS 檔案",
          },
        });
    } finally {
      if (valid(turn)) publish({ deliveryPending: false });
    }
  }
  async function prepare() {
    if (!state.snapshot || !active) return;
    invalidate();
    const turn = generation,
      snapshot = structuredClone(state.snapshot),
      controller = new AbortController();
    publish({ phase: "preparing", problem: null, open: false });
    let cancel: () => void;
    const cancelled = new Promise<never>((_, reject) => {
      cancel = () => {
        controller.abort();
        reject(new Error("cancelled"));
      };
    });
    cancelRequest = cancel!;
    const timer = deps.setTimer(() => {
      if (valid(turn)) {
        generation++;
        cancel!();
        publish({
          phase: "error",
          problem: { kind: "prepare", message: "準備超過三十秒，請重試準備" },
        });
      }
    }, 30000);
    try {
      const result = await Promise.race([
        deps.prepare(structuredClone(snapshot), controller.signal),
        cancelled,
      ]);
      deps.clearTimer(timer);
      if (cancelRequest === cancel!) cancelRequest = undefined;
      if (!valid(turn)) return;
      if (result.status === 401 || result.status === 402) {
        const kind = result.status === 401 ? "auth" : "payment";
        publish({
          phase: "error",
          snapshot: kind === "auth" ? null : state.snapshot,
          problem: {
            kind,
            message:
              kind === "auth"
                ? "請重新登入後明確匯出"
                : "請取得匯出資格後重試準備",
          },
        });
        deps.access(kind);
        return;
      }
      if (result.status === 400) {
        publish({
          phase: "error",
          problem: {
            kind: "invalid",
            message: "課表無法輸出，請檢查並修正目前課表後重新匯出",
          },
        });
        return;
      }
      if (
        result.status < 200 ||
        result.status >= 300 ||
        result.contentType.split(";")[0].trim().toLowerCase() !==
          "text/calendar" ||
        !/^BEGIN:VCALENDAR\r?\n[\s\S]*\r?\nEND:VCALENDAR\s*$/.test(
          result.body.trim(),
        )
      )
        throw new Error("invalid calendar");
      publish({
        phase: "ready",
        result: { accountId, courses: snapshot, ics: result.body },
        open: true,
      });
      if (valid(turn)) {
        void retryImage();
      }
    } catch {
      if (valid(turn))
        publish({
          phase: "error",
          problem: { kind: "prepare", message: "行事曆準備失敗，請重試準備" },
        });
    } finally {
      deps.clearTimer(timer);
      if (cancelRequest === cancel!) cancelRequest = undefined;
    }
  }
  return {
    getSnapshot: () => state,
    matches,
    subscribe: (fn: () => void) => {
      listeners.add(fn);
      return () => {
        listeners.delete(fn);
      };
    },
    async start(courses: Course[], replace = false) {
      if (!active) return;
      if (
        (!replace && state.phase !== "idle") ||
        (state.phase === "preparing" && matches(courses))
      ) {
        publish({ open: true });
        return;
      }
      invalidate();
      publish(initial());
      try {
        publish({ snapshot: exportableCourses(structuredClone(courses)) });
      } catch (e) {
        publish({
          phase: "error",
          problem: {
            kind: "invalid",
            message: e instanceof Error ? e.message : "課表無效",
          },
        });
        return;
      }
      await prepare();
    },
    deliver,
    retryImage,
    retry: async () => {
      if (
        active &&
        state.phase === "error" &&
        state.problem?.kind !== "invalid"
      )
        await prepare();
    },
    close: () => publish({ open: false }),
    reopen: () => {
      if (active) publish({ open: true });
    },
    connect: () => {
      active = true;
    },
    dispose: () => {
      active = false;
      invalidate();
      publish(initial());
    },
  };
}
