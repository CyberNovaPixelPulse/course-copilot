import { isCourseStructure } from "./course-time";
import { type Course } from "./types";

export type PaymentProvider = "ecpay" | "stripe";
export type PaymentReference = { provider: PaymentProvider; paymentId: string };
export type CheckoutDestination = PaymentReference & { destination: string };
export type Confirmation = {
  status: "paid" | "pending" | "wrong-account" | "sign-in";
  usage?: Record<string, unknown>;
};
export type CheckoutState = {
  payment:
    | "idle"
    | "checking"
    | "paid"
    | "pending"
    | "unavailable"
    | "wrong-account"
    | "sign-in";
  starting: PaymentProvider | null;
  problem: "save" | "create" | "storage" | "draft" | null;
  reference?: PaymentReference;
  preferredDraftId?: string;
  usage?: Record<string, unknown>;
};
export type CheckoutDraft = {
  version: 1;
  id: string;
  accountId: string;
  provider: PaymentProvider;
  savedAt: number;
  expiresAt: number;
  courses: Course[];
  paymentId?: string;
};
const PREFIX = "cc_checkout_v1:";
const ATTEMPTS = "cc_checkout_attempt:";
const RETENTION = 7 * 24 * 60 * 60 * 1000;
const validCourses = (value: unknown): value is Course[] =>
  isCourseStructure(value) && value.length > 0;
type Dependencies = {
  resolveAttempt: (
    attemptId: string,
    signal: AbortSignal,
  ) => Promise<PaymentReference | { status: "wrong-account" | "sign-in" }>;
  storage: Pick<
    Storage,
    "length" | "key" | "getItem" | "setItem" | "removeItem"
  >;
  create: (
    provider: PaymentProvider,
    locale: string,
    attemptId: string,
    signal: AbortSignal,
  ) => Promise<CheckoutDestination>;
  depart: (destination: CheckoutDestination) => void;
  confirm: (
    reference: PaymentReference,
    signal: AbortSignal,
  ) => Promise<Confirmation>;
  changed: (state: CheckoutState) => void;
  now: () => number;
  sleep: (ms: number) => Promise<void>;
};

export function createCheckoutRecovery(accountId: string, deps: Dependencies) {
  let current: CheckoutState = {
    payment: "idle",
    starting: null,
    problem: null,
  };
  let disposed = false;
  let checking: Promise<void> | undefined;
  let handled = "";
  let returnAttempt: string | undefined;
  let prepared:
    { destination: CheckoutDestination; draft?: CheckoutDraft } | undefined;
  const abort = new AbortController();
  const scope = `${PREFIX}${encodeURIComponent(accountId)}:`;
  function publish(patch: Partial<CheckoutState>) {
    if (disposed) return;
    current = { ...current, ...patch };
    deps.changed({ ...current });
  }
  function listDrafts(): CheckoutDraft[] {
    if (!accountId || disposed) return [];
    const drafts: CheckoutDraft[] = [];
    try {
      for (let i = 0; i < deps.storage.length; i++) {
        const key = deps.storage.key(i);
        if (!key?.startsWith(scope)) continue;
        try {
          const d = JSON.parse(
            deps.storage.getItem(key) || "null",
          ) as CheckoutDraft;
          if (
            !d ||
            d.version !== 1 ||
            d.accountId !== accountId ||
            key !== scope + d.id ||
            !["ecpay", "stripe"].includes(d.provider) ||
            !Number.isFinite(d.savedAt) ||
            d.expiresAt !== d.savedAt + RETENTION ||
            !validCourses(d.courses) ||
            (d.paymentId !== undefined && typeof d.paymentId !== "string")
          )
            throw new Error("Invalid draft");
          if (d.expiresAt > deps.now()) drafts.push(d);
        } catch {
          publish({ problem: "draft" });
        }
      }
    } catch {
      publish({ problem: "storage" });
    }
    return drafts.sort((a, b) => b.savedAt - a.savedAt);
  }
  function save(draft: CheckoutDraft) {
    deps.storage.setItem(scope + draft.id, JSON.stringify(draft));
  }
  async function start(
    provider: PaymentProvider,
    courses: Course[],
    locale: string,
    skipSave = false,
  ) {
    if (disposed || current.starting) return;
    if (!accountId) {
      publish({ payment: "sign-in" });
      return;
    }
    publish({ starting: provider, problem: null });
    if (prepared && prepared.destination.provider !== provider)
      prepared = undefined;
    if (prepared) {
      try {
        if (!skipSave && prepared.draft && courses.length) {
          if (!validCourses(courses)) throw new Error("Invalid schedule");
          prepared.draft.courses = structuredClone(courses);
          save(prepared.draft);
        }
        deps.depart(prepared.destination);
        prepared = undefined;
      } catch {
        publish({ problem: "save" });
      } finally {
        publish({ starting: null });
      }
      return;
    }
    const id = crypto.randomUUID();
    let draft: CheckoutDraft | undefined;
    if (courses.length && !skipSave) {
      try {
        if (!validCourses(courses)) throw new Error("Invalid schedule");
        const savedAt = deps.now();
        draft = {
          version: 1,
          id,
          accountId,
          provider,
          savedAt,
          expiresAt: savedAt + RETENTION,
          courses: structuredClone(courses),
        };
        save(draft);
      } catch {
        publish({ starting: null, problem: "save" });
        return;
      }
    }
    try {
      const destination = await deps.create(provider, locale, id, abort.signal);
      if (disposed) return;
      prepared = { destination, draft };
      try {
        deps.storage.setItem(
          ATTEMPTS + id,
          JSON.stringify({
            accountId,
            provider,
            paymentId: destination.paymentId,
            savedAt: deps.now(),
          }),
        );
      } catch {
        /* Backend ownership checks still apply when storage is unavailable. */
      }
      if (draft) {
        draft.paymentId = destination.paymentId;
        try {
          save(draft);
        } catch {
          publish({ problem: "save" });
          return;
        }
      }
      publish({ reference: destination, preferredDraftId: draft?.id });
      deps.depart(destination);
      prepared = undefined;
    } catch {
      publish({ problem: "create" });
    } finally {
      publish({ starting: null });
    }
  }
  async function check() {
    if ((!current.reference && !returnAttempt) || disposed) return;
    if (!accountId) {
      publish({ payment: "sign-in" });
      return;
    }
    publish({ payment: "checking" });
    const deadline = deps.now() + 30_000;
    const controller = new AbortController();
    let cancel = () => controller.abort();
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      const expired = new Promise<null>((resolve) => {
        cancel = () => {
          controller.abort();
          resolve(null);
        };
        abort.signal.addEventListener("abort", cancel, { once: true });
        timer = setTimeout(() => {
          controller.abort();
          resolve(null);
        }, 30_000);
      });
      let reference = current.reference;
      if (!reference && returnAttempt) {
        const lookup = await Promise.race([
          deps.resolveAttempt(returnAttempt, controller.signal),
          expired,
        ]);
        if (disposed) return;
        if (!lookup) {
          publish({ payment: "unavailable" });
          return;
        }
        if ("status" in lookup) {
          publish({ payment: lookup.status });
          return;
        }
        reference = lookup;
        const draft = listDrafts().find(
          (d) =>
            d.provider === lookup.provider && d.paymentId === lookup.paymentId,
        );
        publish({ reference, preferredDraftId: draft?.id });
      }
      if (!reference) return;
      while (!disposed) {
        const result = await Promise.race([
          deps.confirm(reference, controller.signal),
          expired,
        ]);
        if (disposed) return;
        if (!result) {
          publish({ payment: "unavailable" });
          return;
        }
        if (result.status !== "pending") {
          publish({ payment: result.status, usage: result.usage });
          return;
        }
        const remaining = deadline - deps.now();
        if (remaining <= 0) {
          publish({ payment: "pending" });
          return;
        }
        await Promise.race([deps.sleep(Math.min(2000, remaining)), expired]);
        if (deps.now() >= deadline) {
          publish({ payment: "pending" });
          return;
        }
      }
    } catch {
      publish({ payment: "unavailable" });
    } finally {
      clearTimeout(timer);
      abort.signal.removeEventListener("abort", cancel);
      controller.abort();
    }
  }
  function recheck() {
    if (checking) return checking;
    checking = check().finally(() => {
      checking = undefined;
    });
    return checking;
  }
  return {
    state: () => ({ ...current }),
    listDrafts,
    start,
    restore(
      id: string,
      hasCurrentCourses: boolean,
      confirmed = false,
    ): {
      status: "restored" | "needs-confirmation" | "unavailable";
      courses?: Course[];
    } {
      const draft = listDrafts().find((d) => d.id === id);
      if (!draft) return { status: "unavailable" };
      if (hasCurrentCourses && !confirmed)
        return { status: "needs-confirmation" };
      return { status: "restored", courses: structuredClone(draft.courses) };
    },
    discard(id: string) {
      if (!listDrafts().some((d) => d.id === id)) return;
      try {
        deps.storage.removeItem(scope + id);
      } catch {
        publish({ problem: "storage" });
      }
    },
    async handleReturn(search: string) {
      if (handled === search) return;
      handled = search;
      const params = new URLSearchParams(search);
      const order = params.get("ecpay_order");
      const session = params.get("session_id");
      let reference: PaymentReference | undefined =
        order && /^[a-z0-9]{1,20}$/i.test(order)
          ? { provider: "ecpay", paymentId: order }
          : session && /^cs_[a-zA-Z0-9_]{1,255}$/.test(session)
            ? { provider: "stripe", paymentId: session }
            : undefined;
      let owner: string | undefined;
      const attemptId = params.get("cc_attempt");
      returnAttempt =
        attemptId && /^[a-zA-Z0-9-]{1,80}$/.test(attemptId)
          ? attemptId
          : undefined;
      try {
        for (let i = 0; i < deps.storage.length; i++) {
          const key = deps.storage.key(i);
          if (!key?.startsWith(ATTEMPTS)) continue;
          try {
            const a = JSON.parse(deps.storage.getItem(key) || "null");
            if (
              !a ||
              typeof a.accountId !== "string" ||
              !["ecpay", "stripe"].includes(a.provider) ||
              typeof a.paymentId !== "string" ||
              !Number.isFinite(a.savedAt) ||
              a.savedAt + RETENTION <= deps.now()
            )
              continue;
            if (
              (attemptId && key === ATTEMPTS + attemptId) ||
              (reference &&
                a.provider === reference.provider &&
                a.paymentId === reference.paymentId)
            ) {
              owner = a.accountId;
              if (!reference)
                reference = { provider: a.provider, paymentId: a.paymentId };
              break;
            }
          } catch {
            /* A broken hint never proves payment or ownership. */
          }
        }
      } catch {
        /* Confirm via the authenticated backend when local hints are unavailable. */
      }
      if (!accountId && (reference || params.has("checkout"))) {
        publish({ payment: "sign-in" });
        return;
      }
      if (owner && owner !== accountId) {
        publish({ payment: "wrong-account" });
        return;
      }
      const draft = listDrafts().find(
        (d) =>
          d.provider === reference?.provider &&
          d.paymentId === reference?.paymentId,
      );
      if (reference) {
        publish({ reference, preferredDraftId: draft?.id });
        await recheck();
      } else if (returnAttempt) {
        await recheck();
      }
    },
    recheck,
    dispose() {
      disposed = true;
      abort.abort();
    },
  };
}
