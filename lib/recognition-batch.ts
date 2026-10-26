import type { Course } from "./types";
import {
  isCourseStructure,
  inspectSchedule,
  overlappingSlots,
} from "./course-time";
export type BatchItemStatus =
  | "preparing"
  | "prepare-error"
  | "ready"
  | "running"
  | "succeeded"
  | "failed"
  | "expired"
  | "pending"
  | "skipped"
  | "storage-error"
  | "needs-confirmation";
export type BatchItem = {
  id: string;
  name: string;
  status: BatchItemStatus;
  jobId?: string;
  courses?: Course[];
  message?: string;
};
export type BatchState = {
  phase: "idle" | "preparing" | "running" | "paused" | "complete" | "ended";
  items: BatchItem[];
  candidate: Course[];
  overlap: boolean;
};
export type JobOutcome = {
  state:
    | "succeeded"
    | "failed"
    | "expired"
    | "pending"
    | "not-found"
    | "auth"
    | "payment";
  courses?: Course[];
  usage?: unknown;
  status?: number;
  message?: string;
};
type Dependencies = {
  storage: Pick<Storage, "getItem" | "setItem" | "removeItem">;
  now: () => number;
  id: () => string;
  fingerprint: (image: Blob) => Promise<string>;
  submit: (
    image: Blob,
    jobId: string,
    signal: AbortSignal,
  ) => Promise<JobOutcome>;
  query: (jobId: string, signal: AbortSignal) => Promise<JobOutcome>;
  beginOperation: () => {
    finish: (payload?: unknown, status?: number) => Promise<void>;
  };
};

const RETENTION = 7 * 86400000;
type Hint = {
  version: 1;
  accountId: string;
  fingerprint: string;
  jobId: string;
  createdAt: number;
};
function validCourses(value: unknown): value is Course[] {
  return (
    isCourseStructure(value) &&
    value.length > 0 &&
    inspectSchedule(value).problems.length === 0
  );
}
function combine(items: BatchItem[]) {
  const courses: Course[] = [],
    seen = new Set<string>();
  for (const item of items)
    if (item.status === "succeeded")
      for (const course of item.courses ?? []) {
        const slots = course.slots.filter((slot) => {
          const key = JSON.stringify([
            course.name,
            course.professor,
            slot.weekday,
            slot.startTime,
            slot.endTime,
            slot.location,
          ]);
          if (seen.has(key)) return false;
          seen.add(key);
          return true;
        });
        if (slots.length) courses.push({ ...course, slots });
      }
  const overlap = overlappingSlots(courses).length > 0;
  return { candidate: courses, overlap };
}
export function createRecognitionBatch(accountId: string, deps: Dependencies) {
  let state: BatchState = {
    phase: "idle",
    items: [],
    candidate: [],
    overlap: false,
  };
  let items: BatchItem[] = [],
    generation = 0,
    disposed = false;
  let lock: symbol | undefined;
  const images = new Map<string, Blob>(),
    fingerprints = new Map<string, string>(),
    unsent = new Map<string, Hint>();
  const listeners = new Set<() => void>(),
    controllers = new Set<AbortController>();
  function publish() {
    if (disposed) return;
    state = {
      ...state,
      items: items.map((i) => ({ ...i })),
      ...combine(items),
    };
    listeners.forEach((l) => l());
  }
  const key = (fingerprint: string) =>
    `cc_pending_job:${accountId}:${fingerprint}`;
  async function bounded<T>(
    action: (signal: AbortSignal) => Promise<T>,
    ms: number,
  ): Promise<T> {
    const controller = new AbortController();
    controllers.add(controller);
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      return await Promise.race([
        action(controller.signal),
        new Promise<never>((_, reject) => {
          controller.signal.addEventListener(
            "abort",
            () => reject(new Error("Waiting ended")),
            { once: true },
          );
          timer = setTimeout(() => controller.abort(), ms);
        }),
      ]);
    } finally {
      clearTimeout(timer);
      controllers.delete(controller);
      controller.abort();
    }
  }
  function terminal(item: BatchItem) {
    if (!["succeeded", "failed", "expired"].includes(item.status)) return;
    const fingerprint = fingerprints.get(item.id);
    if (fingerprint)
      try {
        const raw = deps.storage.getItem(key(fingerprint));
        let stored: unknown;
        try {
          stored = raw ? JSON.parse(raw) : null;
        } catch {
          stored = raw;
        }
        const storedId =
          typeof stored === "string"
            ? stored
            : stored && typeof stored === "object"
              ? (stored as Hint).jobId
              : undefined;
        if (storedId === item.jobId) deps.storage.removeItem(key(fingerprint));
      } catch {
        item.message = "結果已確認，但本機線索暫時無法清理。";
      }
  }
  function apply(item: BatchItem, outcome: JobOutcome) {
    item.message = outcome.message;
    if (outcome.state === "succeeded" && validCourses(outcome.courses)) {
      item.status = "succeeded";
      item.courses = inspectSchedule(outcome.courses).courses;
    } else if (["failed", "expired", "auth", "payment"].includes(outcome.state))
      item.status = outcome.state === "expired" ? "expired" : "failed";
    else {
      item.status = "pending";
      if (outcome.state === "succeeded")
        item.message = "結果暫時無法完整讀取，請查詢原工作。";
    }
    terminal(item);
    publish();
  }
  async function queryItem(item: BatchItem, turn: number) {
    if (!item.jobId) return;
    item.status = "running";
    publish();
    const operation = deps.beginOperation();
    try {
      const outcome = await bounded(
        (signal) => deps.query(item.jobId!, signal),
        15000,
      );
      void operation.finish(outcome.usage, outcome.status ?? 200);
      if (!disposed && generation === turn)
        apply(
          item,
          outcome.state === "auth" ? { ...outcome, state: "pending" } : outcome,
        );
    } catch {
      void operation.finish(undefined, 0);
      if (!disposed && generation === turn) {
        item.status = "pending";
        item.message = "暫時無法確認，請重新查詢原工作。";
        publish();
      }
    }
  }
  async function process(item: BatchItem, turn: number, newConfirmed = false) {
    const image = images.get(item.id);
    if (!image) return;
    let fingerprint: string;
    try {
      fingerprint = await deps.fingerprint(image);
    } catch {
      item.status = "prepare-error";
      item.message = "圖片準備失敗，請重試。";
      publish();
      return;
    }
    if (disposed || generation !== turn) return;
    fingerprints.set(item.id, fingerprint);
    let hint = unsent.get(item.id);
    if (!hint && !newConfirmed) {
      let raw: string | null;
      try {
        raw = deps.storage.getItem(key(fingerprint));
      } catch {
        item.status = "storage-error";
        item.message = "無法保存工作線索，圖片尚未送出。請重試。";
        publish();
        return;
      }
      if (raw) {
        let parsed: unknown;
        try {
          parsed = JSON.parse(raw);
        } catch {
          parsed = raw;
        }
        let known: string | undefined;
        if (typeof parsed === "string" && /^[a-zA-Z0-9_-]{8,100}$/.test(parsed))
          known = parsed;
        else if (parsed && typeof parsed === "object") {
          const h = parsed as Hint;
          if (
            h.version === 1 &&
            h.accountId === accountId &&
            h.fingerprint === fingerprint &&
            typeof h.jobId === "string" &&
            /^[a-zA-Z0-9_-]{8,100}$/.test(h.jobId) &&
            Number.isFinite(h.createdAt) &&
            h.createdAt <= deps.now() &&
            deps.now() - h.createdAt < RETENTION
          )
            known = h.jobId;
        }
        if (!known) {
          item.status = "needs-confirmation";
          item.message =
            "舊工作線索已過期或無法讀取。請先查看最近辨識；建立新工作成功會再扣一次。";
          publish();
          return;
        }
        item.jobId = known;
        await queryItem(item, turn);
        return;
      }
    }
    if (!hint) {
      hint = {
        version: 1,
        accountId,
        fingerprint,
        jobId: deps.id(),
        createdAt: deps.now(),
      };
      unsent.set(item.id, hint);
    }
    item.jobId = hint.jobId;
    try {
      deps.storage.setItem(key(fingerprint), JSON.stringify(hint));
    } catch {
      item.status = "storage-error";
      item.message = "無法保存工作線索，圖片尚未送出。請重試。";
      publish();
      return;
    }
    unsent.delete(item.id);
    item.status = "running";
    item.message = undefined;
    publish();
    const operation = deps.beginOperation();
    try {
      const outcome = await bounded(
        (signal) => deps.submit(image, hint!.jobId, signal),
        90000,
      );
      void operation.finish(outcome.usage, outcome.status ?? 200);
      if (disposed || generation !== turn) return;
      apply(item, outcome);
    } catch {
      void operation.finish(undefined, 0);
      if (!disposed && generation === turn) await queryItem(item, turn);
    }
  }
  async function exclusive(action: (turn: number) => Promise<void>) {
    if (disposed || lock || !accountId || state.phase === "ended") return;
    const token = Symbol("batch operation"),
      turn = generation;
    lock = token;
    state.phase = "running";
    publish();
    try {
      await action(turn);
    } finally {
      if (lock === token) lock = undefined;
      if (!disposed && generation === turn) {
        state.phase = items.every(
          (i) => i.status === "succeeded" || i.status === "skipped",
        )
          ? "complete"
          : "paused";
        publish();
      }
    }
  }
  return {
    getSnapshot: () => state,
    start() {
      disposed = false;
    },
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    open(names: string[]) {
      if (
        disposed ||
        !accountId ||
        !names.length ||
        !["idle", "ended", "complete"].includes(state.phase)
      )
        return false;
      generation++;
      images.clear();
      fingerprints.clear();
      unsent.clear();
      items = names.map((name) => ({
        id: deps.id(),
        name,
        status: "preparing",
      }));
      state = { phase: "preparing", items: [], candidate: [], overlap: false };
      publish();
      return true;
    },
    prepared(id: string, image: Blob) {
      const item = items.find((i) => i.id === id);
      if (
        disposed ||
        lock ||
        !item ||
        !["preparing", "prepare-error"].includes(item.status)
      )
        return;
      images.set(id, image);
      item.status = "ready";
      item.message = undefined;
      publish();
    },
    preparationFailed(id: string) {
      const item = items.find((i) => i.id === id);
      if (!item || disposed || lock) return;
      item.status = "prepare-error";
      item.message = "圖片準備失敗，尚未送出。可重試、略過或取消這批。";
      state.phase = "paused";
      publish();
    },
    continue() {
      return exclusive(async (turn) => {
        for (const item of items) {
          if (disposed || generation !== turn) return;
          if (["succeeded", "skipped"].includes(item.status)) continue;
          if (!["ready", "storage-error"].includes(item.status)) break;
          await process(item, turn);
          if (item.status !== "succeeded") break;
        }
      });
    },
    retry(id: string) {
      return exclusive(async (turn) => {
        const item = items.find((i) => i.id === id);
        if (
          item &&
          ["failed", "expired", "storage-error", "prepare-error"].includes(
            item.status,
          )
        )
          await process(
            item,
            turn,
            ["failed", "expired"].includes(item.status),
          );
      });
    },
    confirmNew(id: string, confirmed: boolean) {
      if (!confirmed) return Promise.resolve();
      return exclusive(async (turn) => {
        const item = items.find((i) => i.id === id);
        if (item?.status === "needs-confirmation")
          await process(item, turn, true);
      });
    },
    check(id: string) {
      return exclusive(async (turn) => {
        const item = items.find((i) => i.id === id);
        if (item?.status === "pending") await queryItem(item, turn);
      });
    },
    skip(id: string) {
      const item = items.find((i) => i.id === id);
      if (
        !item ||
        lock ||
        disposed ||
        item.status === "succeeded" ||
        item.status === "running"
      )
        return;
      item.status = "skipped";
      item.message = undefined;
      images.delete(id);
      state.phase = "paused";
      publish();
    },
    end() {
      generation++;
      lock = undefined;
      images.clear();
      fingerprints.clear();
      unsent.clear();
      items = [];
      state = { phase: "ended", items: [], candidate: [], overlap: false };
      publish();
    },
    dispose() {
      disposed = true;
      lock = undefined;
      generation++;
      controllers.forEach((c) => c.abort());
      images.clear();
      fingerprints.clear();
      unsent.clear();
      items = [];
      state = { phase: "ended", items: [], candidate: [], overlap: false };
      listeners.clear();
    },
    loadCandidate(
      hasCurrent: boolean,
      confirmed = false,
    ): {
      status: "restored" | "needs-confirmation" | "unavailable";
      courses?: Course[];
    } {
      if (!state.candidate.length) return { status: "unavailable" };
      if (hasCurrent && !confirmed) return { status: "needs-confirmation" };
      return { status: "restored", courses: structuredClone(state.candidate) };
    },
  };
}
