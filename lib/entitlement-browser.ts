import {
  createEntitlementDisplay,
  EntitlementReadError,
} from "./entitlement-display";
const CHANGE_KEY = "cc_entitlement_changed";

export function createBrowserEntitlementDisplay(accountId: string) {
  let channel: BroadcastChannel | undefined;
  const store = createEntitlementDisplay(accountId, {
    async read(signal) {
      const response = await fetch("/api/user/usage", {
        cache: "no-store",
        signal: AbortSignal.any([signal, AbortSignal.timeout(30_000)]),
      });
      if (!response.ok) throw new EntitlementReadError(response.status);
      return response.json();
    },
    notify() {
      // Only an invalidation hint; neither account data nor a snapshot is sent.
      if (channel) channel.postMessage("changed");
      else {
        try {
          window.localStorage.setItem(CHANGE_KEY, crypto.randomUUID());
        } catch {
          /* Foreground refresh remains available. */
        }
      }
    },
  });
  return {
    store,
    connect() {
      const changed = () => {
        void store.refresh("changed");
      };
      try {
        if (typeof BroadcastChannel !== "undefined") {
          channel = new BroadcastChannel(CHANGE_KEY);
          channel.onmessage = changed;
        }
      } catch {
        /* Use the storage invalidation adapter when BroadcastChannel is unavailable. */
      }
      const storage = (event: StorageEvent) => {
        if (event.key === CHANGE_KEY) changed();
      };
      const foreground = () => {
        if (document.visibilityState === "visible") void store.refresh();
      };
      window.addEventListener("storage", storage);
      window.addEventListener("focus", foreground);
      document.addEventListener("visibilitychange", foreground);
      void store.start();
      return () => {
        store.dispose();
        channel?.close();
        channel = undefined;
        window.removeEventListener("storage", storage);
        window.removeEventListener("focus", foreground);
        document.removeEventListener("visibilitychange", foreground);
      };
    },
  };
}
