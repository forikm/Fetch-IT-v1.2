"use client";

import { Button } from "@/components/ui/button";
export function RoadRouteStatus({ loading, error, warnings, onRetry }: {
  loading: boolean; error: string | null; warnings: string[]; onRetry: () => void;
}) {
  return <div className="absolute left-2 right-12 top-2 z-10 w-fit max-w-[calc(100%-4rem)] rounded-lg border bg-card/95 px-3 py-2 text-xs shadow-sm">
    {loading ? <p role="status">Finding road route…</p> : error ? <div role="alert" className="space-y-2"><p>{error}</p><Button type="button" size="sm" variant="outline" onClick={onRetry}>Retry road route</Button></div> : <p>Road route · <a className="underline" href="https://openrouteservice.org/" target="_blank" rel="noreferrer">© openrouteservice / HeiGIT</a></p>}
    {warnings.length > 0 && <details className="mt-2"><summary className="cursor-pointer py-2 font-medium">Route notices</summary><ul className="max-h-32 list-disc space-y-1 overflow-y-auto pl-4">{warnings.map((warning, index) => <li key={index}>{warning}</li>)}</ul></details>}
  </div>;
}
