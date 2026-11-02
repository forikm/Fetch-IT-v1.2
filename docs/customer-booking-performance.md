# Customer booking performance

The customer project deploys to `sin1` using `vercel.json`, overriding its old
Washington default. This colocates its functions with the Singapore database.
Other app projects retain their own deployment configurations.

Booking confirmation, fare, list/status/detail and simulated-checkout resolution
responses expose `X-Request-ID`, `X-Function-Region` and `Server-Timing`.
The `app` metric measures handler wall time; it includes application-level
authentication and database/network waits, and excludes platform cold startup,
client networking, rendering and Next.js `after()` work.

Logs with `operation: booking.performance` contain response duration, action,
region, deployment, a random client correlation ID (when supplied), and bounded
phase timings. Every mutation, error and response >=5,000 ms is logged. Fast
successful reads are sampled at approximately 1/20 to limit polling overhead.
Database spans include network, pool and database execution costs together.
Transaction and routing totals contain nested phases: do not sum all spans.
The residual transaction time cannot isolate pool acquisition versus commit.

Client confirmation/fare measurements use `performance.now()` and an independent
random event ID. Confirmation feedback is measured approximately after two
animation frames; checkout redirects are reported before navigation. These are
client-reported measurements, not a trusted server SLA or complete checkout-load
timing. Reports use a best-effort same-origin keepalive POST, never awaited by the
booking flow. Backgrounded/closed pages may lose reports.

`/api/telemetry/booking` requires a live customer session, checks origin, bounds
the body at 2 KiB while reading, validates fields, and rate limits ingestion. Its
logs contain only approved timing fields. No booking details, contact data, SQL,
coordinates, message text, user IDs, idempotency keys or provider secrets are
recorded. Browser reports are labeled `source: client_reported`.

To find slow events, search logs for `booking.performance` or
`booking.client_performance` and `slow:true`, then correlate `requestId` and
`clientEventId`. Browser round-trip minus handler duration includes several
unmeasured components (cold start, platform queuing, network and body transfer);
do not describe that difference as pure network latency.

This change adds no database migration, new provider, payment behavior change or
log retention extension. Hobby logs still expire after one hour. Export relevant
events within that window; longer-term storage is a separate follow-up.

## Release validation

Run booking telemetry, confirmation, performance, routing, coverage, history,
notification and proof regressions; TypeScript, lint and a production build.
After deployment, verify `X-Function-Region: sin1` on `/api/bookings` and ensure
the source commit is Ready in Vercel. An unauthenticated 401 is safe for checking
headers but does not benchmark an authenticated booking or its database work.

Compare real click durations after a normal customer booking with the newly
recorded backend phases. Do not create unwanted production bookings merely to
claim a successful benchmark or infer speedups from CPU totals.
