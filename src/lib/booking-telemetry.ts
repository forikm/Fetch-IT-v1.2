import { AsyncLocalStorage } from "node:async_hooks";
import { randomUUID } from "node:crypto";
import { performance } from "node:perf_hooks";
import type { NextRequest } from "next/server";

type Span = { name: string; durationMs: number };
type Timing = { active: boolean; spans: Span[]; dropped: number };
const timings = new AsyncLocalStorage<Timing>();
const round = (ms: number) => Math.round(Math.max(0, ms) * 10) / 10;
export const validTimingId = (value: unknown): value is string => typeof value === "string" && /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(value);

// Fixed phase names only: never SQL, URLs, booking IDs, addresses or payloads.
export function recordBookingTiming(name: string, durationMs: number) {
  const context = timings.getStore();
  if (!context?.active || !/^[a-z][a-z0-9_.]{0,47}$/.test(name) || !Number.isFinite(durationMs)) return;
  if (context.spans.length >= 40) { context.dropped++; return; }
  context.spans.push({ name, durationMs: round(durationMs) });
}
export async function timeBooking<T>(name: string, work: () => Promise<T>): Promise<T> {
  if (!timings.getStore()?.active) return work();
  const started = performance.now();
  try { return await work(); }
  finally { recordBookingTiming(name, performance.now() - started); }
}

export function withBookingTelemetry<Args extends [NextRequest, ...unknown[]]>(action: string, handler: (...args: Args) => Promise<Response>) {
  return async (...args: Args) => {
    const started = performance.now();
    const context: Timing = { active: true, spans: [], dropped: 0 };
    const suppliedId = args[0].headers.get("X-Booking-Event-ID");
    let response: Response | undefined;
    return timings.run(context, async () => {
      try { response = await handler(...args); return response; }
      finally {
        // Next's after() work may inherit this context. Exclude it from both the
        // response measurement and the saved phases once the handler returns.
        context.active = false;
        try {
          const durationMs = round(performance.now() - started);
          const returnedId = response?.headers.get("X-Request-ID");
          const requestId = validTimingId(returnedId) ? returnedId : randomUUID();
          const region = /^[a-z]{3}\d$/.test(process.env.VERCEL_REGION ?? "") ? process.env.VERCEL_REGION! : "local";
          response?.headers.set("X-Request-ID", requestId);
          response?.headers.set("X-Function-Region", region);
          response?.headers.set("Server-Timing", [
            `app;dur=${durationMs}`,
            ...context.spans.map((span, index) => `phase${index};dur=${span.durationMs};desc="${span.name}"`),
          ].join(", "));
          const slow = durationMs >= 5000;
          // Capture every mutation, error and slow read; sample fast polling to
          // keep telemetry from multiplying normal polling volume.
          if (args[0].method !== "GET" || !response || response.status >= 400 || slow || parseInt(requestId.slice(0, 4), 16) % 20 === 0) {
            console.info(JSON.stringify({ operation: "booking.performance", action, phase: "response", requestId,
              ...(validTimingId(suppliedId) ? { clientEventId: suppliedId } : {}), region,
              deployment: /^[a-f0-9]{7,40}$/i.test(process.env.VERCEL_GIT_COMMIT_SHA ?? "") ? process.env.VERCEL_GIT_COMMIT_SHA!.slice(0, 12) : "local",
              method: args[0].method, status: response?.status ?? 500, durationMs, slow, spans: context.spans, droppedSpans: context.dropped,
            }));
          }
        } catch { /* A telemetry failure must never replace the booking response. */ }
      }
    });
  };
}
