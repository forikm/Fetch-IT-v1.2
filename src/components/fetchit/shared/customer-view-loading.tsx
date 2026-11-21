"use client";

/** Content-only fallback: the customer navigation remains interactive. */
export function CustomerViewLoading() {
  return <section role="status" aria-label="Loading page" className="space-y-4 py-2">
    <span className="sr-only">Loading page…</span>
    <div aria-hidden="true" className="space-y-4 animate-pulse motion-reduce:animate-none">
      <div className="h-7 w-40 rounded-lg bg-muted" />
      <div className="h-12 rounded-xl bg-muted" />
      <div className="h-40 rounded-2xl border bg-card" />
    </div>
  </section>;
}
