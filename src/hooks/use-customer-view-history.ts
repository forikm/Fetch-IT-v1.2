"use client";

import { useEffect } from "react";
import { useAppStore, type AppView } from "@/lib/store";

const views: AppView[] = ["landing", "login", "signup", "onboarding", "customer-profile", "mode-select", "customer-dashboard", "ride-dashboard"];

/** Keep browser Back within the customer's navigation, without restoring authentication. */
export function useCustomerViewHistory(ready: boolean) {
  useEffect(() => {
    if (!ready) return;
    let restoring = false;
    const remember = (view: AppView, replace: boolean, resetOverlay = false) => {
      const state = { ...window.history.state, fetchitView: view };
      if (resetOverlay) delete state.fetchitOverlay;
      if (replace) window.history.replaceState(state, "");
      else window.history.pushState(state, "");
    };
    remember(useAppStore.getState().view, true, true);
    const unsubscribe = useAppStore.subscribe((next, previous) => {
      if (restoring || next.view === previous.view) return;
      remember(next.view, next.user?.id !== previous.user?.id, true);
    });
    const restore = (event: PopStateEvent) => {
      const requested = event.state?.fetchitView;
      if (!views.includes(requested)) return;
      const current = useAppStore.getState();
      const protectedView = ["onboarding", "customer-profile", "mode-select", "customer-dashboard", "ride-dashboard"].includes(requested);
      const view = !current.user && protectedView ? "landing"
        : current.user && ["login", "signup", "landing"].includes(requested) ? "mode-select" : requested;
      restoring = true;
      current.setView(view);
      restoring = false;
      remember(view, true);
    };
    window.addEventListener("popstate", restore);
    return () => { unsubscribe(); window.removeEventListener("popstate", restore); };
  }, [ready]);
}
