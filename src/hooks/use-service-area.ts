"use client";

import { useEffect, useState } from "react";

type Coverage = typeof import("@/lib/service-area");

/** Load detailed map data only when selecting a booking location. */
export function useServiceArea(enabled = true) {
  const [area, setArea] = useState<Coverage | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    void import("@/lib/service-area").then(module => {
      if (!cancelled) setArea(module);
    }).catch(() => { if (!cancelled) setFailed(true); });
    return () => { cancelled = true; };
  }, [enabled]);
  return { area, failed };
}
