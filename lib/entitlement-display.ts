export type EntitlementSnapshot = {
  accountId: string;
  freeRemaining: number;
  creditRemaining: number;
  totalRemaining: number;
  canExport: boolean;
  stripeCheckoutEnabled: boolean;
};
export type EntitlementDisplayState = {
  status: "loading" | "updating" | "ready" | "error" | "sign-in";
  snapshot: EntitlementSnapshot | null;
};
type Dependencies = {
  read: (signal: AbortSignal) => Promise<unknown>;
  notify: () => void;
};
function normalize(
  payload: unknown,
  accountId: string,
): EntitlementSnapshot | null {
  if (!payload || typeof payload !== "object")
    throw new Error("Invalid entitlement");
  const outer = payload as Record<string, unknown>;
  const data = (
    outer.usage && typeof outer.usage === "object" ? outer.usage : outer
  ) as Record<string, unknown>;
  if (
    (typeof outer.userId === "string" && outer.userId !== accountId) ||
    (typeof data.userId === "string" && data.userId !== accountId)
  )
    return null;
  const free = data.freeScansRemaining,
    credits = data.gpt4oRemaining;
  const canExport = data.canExportIcs ?? data.paid;
  if (
    data.userId !== accountId ||
    !Number.isSafeInteger(free) ||
    (free as number) < 0 ||
    !Number.isSafeInteger(credits) ||
    (credits as number) < 0 ||
    typeof canExport !== "boolean" ||
    (data.paid !== undefined && data.paid !== canExport) ||
    (data.stripeCheckoutEnabled !== undefined &&
      typeof data.stripeCheckoutEnabled !== "boolean")
  )
    throw new Error("Invalid entitlement");
  const total = (free as number) + (credits as number);
  if (
    !Number.isSafeInteger(total) ||
    (data.remaining !== undefined && data.remaining !== total)
  )
    throw new Error("Inconsistent entitlement");
  return {
    accountId,
    freeRemaining: free as number,
    creditRemaining: credits as number,
    totalRemaining: total,
    canExport,
    stripeCheckoutEnabled: data.stripeCheckoutEnabled === true,
  };
}

export function createEntitlementDisplay(
  accountId: string,
  deps: Dependencies,
) {
  let state: EntitlementDisplayState = {
    status: accountId ? "loading" : "sign-in",
    snapshot: null,
  };
  const listeners = new Set<() => void>();
  let inflight: Promise<void> | undefined;
  let readingRevision = 0;
  let revision = 0,
    epoch = 0;
  let disposed = false,
    signedOut = !accountId,
    dirty = false,
    converge = false;
  const operations = new Set<symbol>();
  const controllers = new Set<AbortController>();
  function publish(patch: Partial<EntitlementDisplayState>) {
    if (disposed) return;
    state = { ...state, ...patch };
    listeners.forEach((listener) => listener());
  }
  function unauthenticated() {
    epoch++;
    revision++;
    signedOut = true;
    dirty = false;
    converge = false;
    operations.clear();
    controllers.forEach((c) => c.abort());
    publish({ snapshot: null, status: "sign-in" });
  }
  const updating = () =>
    publish({ status: state.snapshot ? "updating" : "loading" });
  function refresh(reason: "refresh" | "changed" = "refresh"): Promise<void> {
    if (disposed || signedOut) return Promise.resolve();
    if (reason === "changed") {
      dirty = true;
      revision++;
      updating();
    }
    if (operations.size) {
      dirty = true;
      return inflight ?? Promise.resolve();
    }
    if (inflight) {
      if (readingRevision !== revision) {
        dirty = true;
        updating();
      }
      return inflight;
    }
    updating();
    const session = epoch;
    const request = (async () => {
      do {
        dirty = false;
        const started = revision;
        readingRevision = started;
        updating();
        const controller = new AbortController();
        controllers.add(controller);
        try {
          const payload = await Promise.race([
            deps.read(controller.signal),
            new Promise<never>((_, reject) =>
              controller.signal.addEventListener(
                "abort",
                () => reject(new Error("Cancelled")),
                { once: true },
              ),
            ),
          ]);
          if (disposed || session !== epoch || started !== revision) continue;
          const snapshot = normalize(payload, accountId);
          if (snapshot) publish({ snapshot, status: "ready" });
        } catch (error) {
          if (!disposed && session === epoch && started === revision) {
            if (error instanceof EntitlementReadError && error.status === 401)
              unauthenticated();
            else publish({ status: "error" });
          }
        } finally {
          controllers.delete(controller);
          controller.abort();
        }
      } while (
        dirty &&
        !operations.size &&
        !disposed &&
        !signedOut &&
        session === epoch
      );
    })().finally(() => {
      if (inflight === request) inflight = undefined;
    });
    inflight = request;
    return request;
  }
  return {
    getSnapshot: () => state,
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    refresh,
    requireSignIn: unauthenticated,
    start() {
      disposed = false;
      return refresh();
    },
    dispose() {
      disposed = true;
      inflight = undefined;
      epoch++;
      revision++;
      dirty = false;
      converge = false;
      operations.clear();
      controllers.forEach((c) => c.abort());
    },
    beginOperation() {
      const id = Symbol("operation"),
        session = epoch;
      if (!disposed && !signedOut) {
        if (operations.size) converge = true;
        operations.add(id);
        revision++;
        updating();
      }
      return {
        async finish(payload?: unknown, status = 200) {
          if (disposed || session !== epoch || !operations.delete(id)) return;
          if (status === 401) {
            unauthenticated();
            return;
          }
          let accepted = false,
            invalid = false;
          if (payload !== undefined) {
            try {
              const snapshot = normalize(payload, accountId);
              if (snapshot) {
                accepted = true;
                revision++;
                publish({
                  snapshot,
                  status:
                    operations.size || converge || dirty ? "updating" : "ready",
                });
              }
            } catch {
              invalid = true;
              publish({ status: "error" });
            }
          } else dirty = true;
          if (
            accepted ||
            (payload === undefined && (status === 0 || status < 400))
          ) {
            try {
              deps.notify();
            } catch {
              /* Notification failure does not invalidate confirmed account data. */
            }
          }
          if (!operations.size) {
            const needsRead = converge || dirty;
            converge = false;
            if (needsRead) await refresh("changed");
            else if (!accepted && !invalid && state.snapshot)
              publish({ status: "ready" });
          }
        },
      };
    },
  };
}

export class EntitlementReadError extends Error {
  constructor(public readonly status: number) {
    super("Unable to confirm account benefits");
  }
}
