"use client";
import { useEffect, useRef } from "react";
let nextOverlay = 0;
const parents = new Map<string, string | undefined>();

/** Give phone/browser Back the same meaning as closing the current overlay. */
export function useCustomerOverlayHistory(open: boolean, onBack: () => boolean | void) {
  const close = useRef(onBack);
  useEffect(() => { close.current = onBack; }, [onBack]);
  useEffect(() => {
    if (!open) return;
    const token = "customer-overlay-" + ++nextOverlay;
    parents.set(token, window.history.state?.fetchitOverlay);
    const entry = { ...window.history.state, fetchitOverlay: token };
    window.history.pushState(entry, "");
    const pop = () => {
      let current: string | undefined = window.history.state?.fetchitOverlay;
      while (current) { if (current === token) return; current = parents.get(current); }
      // A nested overlay still owns Back when its parent entry remains active.
      if (close.current() === false) window.history.pushState(entry, "");
    };
    window.addEventListener("popstate", pop);
    return () => {
      window.removeEventListener("popstate", pop);
      parents.delete(token);
      if (window.history.state?.fetchitOverlay === token) window.history.back();
    };
  }, [open]);
}
