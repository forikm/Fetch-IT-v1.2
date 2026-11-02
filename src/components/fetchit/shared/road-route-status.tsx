"use client";

import { Button } from "@/components/ui/button";
export function RoadRouteStatus({ loading, error, warnings, onRetry }: {
  loading: boolean; error: string | null; warnings: string[]; onRetry: () => void;
}) {
  return <div className="absolute left-2 top-2 z-10 max-w-[calc(100%-4rem)] rounded-lg border bg-card/95 text-xs shadow-sm">
    <details>
    <summary className="flex min-h-12 cursor-pointer items-center px-3 font-medium">{error ? "Route unavailable" : loading ? "Finding route..." : warnings.length ? "Route notices" : "Route info"}</summary>
    <div className="max-h-40 space-y-2 overflow-y-auto px-3 pb-3">
      {loading ? <p role="status">Finding road route...</p> : error ? <div role="alert" className="space-y-2"><p>{error}</p><Button type="button" size="sm" variant="outline" onClick={onRetry}>Retry road route</Button></div> : <p>Road route · <a className="underline" href="https://openrouteservice.org/" target="_blank" rel="noreferrer">© openrouteservice / HeiGIT</a></p>}
      {warnings.length > 0 && <ul className="list-disc space-y-1 pl-4">{warnings.map((warning, index) => <li key={index}>{warning}</li>)}</ul>}
    </div>
    </details>
    <a className="block px-3 pb-2 underline" href="https://openrouteservice.org/" target="_blank" rel="noreferrer">© openrouteservice / HeiGIT</a>
  </div>;
}
