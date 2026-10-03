"use client";
import { useEffect, useRef } from "react";

// Use the latest callback without restarting the timer on every render.
export function useVisiblePoll(key: string, poll: (signal: AbortSignal) => Promise<void>, intervalMs = 3000) {
  const callback = useRef(poll);
  useEffect(() => { callback.current = poll; }, [poll]);
  useEffect(() => {
    if (!key) return;
    let running = false;
    let stopped = false;
    let controller: AbortController | undefined;
    const refresh = async () => {
      if (stopped || running || document.visibilityState === "hidden" || !navigator.onLine) return;
      running = true;
      controller = new AbortController();
      const deadline = setTimeout(() => controller?.abort(), 10000);
      try { await callback.current(controller.signal); }
      catch { /* The caller reports request errors when appropriate. */ }
      finally { clearTimeout(deadline); running = false; }
    };
    void refresh();
    const timer = setInterval(() => void refresh(), intervalMs);
    window.addEventListener("online", refresh);
    window.addEventListener("focus", refresh);
    document.addEventListener("visibilitychange", refresh);
    return () => {
      stopped = true; controller?.abort(); clearInterval(timer);
      window.removeEventListener("online", refresh);
      window.removeEventListener("focus", refresh);
      document.removeEventListener("visibilitychange", refresh);
    };
  }, [key, intervalMs]);
}
