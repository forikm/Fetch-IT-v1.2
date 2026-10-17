"use client";

// Registers /sw.js on mount (production + dev). Silent no-op on unsupported
// browsers. Also handles "controllerchange" so a new SW takes over
// immediately when ready.

import { useEffect } from "react";
import { useAppStore } from "@/lib/store";
import { setPushAccount } from "@/lib/customer-push";

export function ServiceWorkerRegister() {
  useEffect(() => {
    if (typeof window === "undefined") return;
    if (!("serviceWorker" in navigator)) return;
    if (process.env.NODE_ENV !== "production" && process.env.NEXT_PUBLIC_SW_DEV !== "true") {
      // Skip in dev to avoid caching surprises; flip NEXT_PUBLIC_SW_DEV=true to test.
      return;
    }
    const onLoad = () => {
      navigator.serviceWorker
        .register("/sw.js", { scope: "/" })
        .then(syncAccount)
        .catch((err) => console.warn("[sw] registration failed", err));
    };
    const syncAccount = () => {
      const state = useAppStore.getState();
      if (state.bootstrapped) void setPushAccount(state.user?.role === "CUSTOMER" ? state.user.id : null).catch(() => {});
    };
    navigator.serviceWorker.addEventListener("controllerchange", syncAccount);
    if (document.readyState === "complete") onLoad();
    else window.addEventListener("load", onLoad, { once: true });
    return () => {
      window.removeEventListener("load", onLoad);
      navigator.serviceWorker.removeEventListener("controllerchange", syncAccount);
    };
  }, []);
  return null;
}
