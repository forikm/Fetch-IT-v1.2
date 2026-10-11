# Fetch-It demo payments

This feature simulates payment to Fetch-It, completed-booking commission and
rider earnings, and an admin-reviewed payout. It has no payment-provider
integration, requires no wallet or bank credentials, and never moves money.

Customer payment options are cash (the existing real cash-confirmation flow),
GCash (demo), Maya (demo), and bank payment (demo). The online options open a
Fetch-It demo checkout with success, failure, and cancellation controls. A failed
or cancelled checkout can be retried. Closing checkout leaves it pending and it
can be resumed from the payment card. A booking itself remains active until
explicitly cancelled.

Demo bookings are hidden from the available jobs board until checkout succeeds.
Assignment and acceptance also enforce this on the server. Paid demo bookings
can be reassigned before pickup because no cash was collected by the old rider.
Cash bookings retain their existing confirmation/reassignment rules.

Completion of a paid demo booking records commission and rider earnings once,
in the same transaction as completion. `DEMO_COMMISSION_PERCENT` in the customer
server environment defaults to 15 and accepts 0–100 with up to two decimal
places. The rate is saved with the booking; changing configuration affects only
new bookings. Commission is rounded to the nearest cent, and the remainder is
the rider's earnings. At 15%, a PHP 60 fare records PHP 9 commission and PHP 51
rider earnings. Simulated processor fees are zero; these figures are not a
prediction of actual gateway costs or net profit.

Admin booking details show demo commission, rider earnings, and payout state.
For a completed, paid demo booking, submit a reference and review note to record
one simulated payout. It is an accounting record only, not a transfer. Retries
with the same reference do not duplicate it. A demo payout cannot be recorded
before completion or after refund. A completed paid demo booking can be
simulated as refunded before its payout, clearing its earnings. Cancelling an
active demo booking closes checkout and records a simulated refund if paid.

Rider stats display demo earnings, awaiting review, and simulated payouts
separately from completed cash fares. Admin confirmed cash collections exclude
demo payments. Receipts and payment methods identify demo records explicitly.

## Database and deployment

1. From `fetch-customer`, run `npm run db:sync` and `npm run db:deploy`.
2. Build and deploy customer, rider, and admin together with the shared schema.
3. Optionally set `DEMO_COMMISSION_PERCENT` on the customer deployment before
   creating new demo bookings. No API keys, business registration, or TIN are
   needed for this local simulation.

Only `fetch-customer` owns and deploys migrations. This adds enum values, demo
accounting fields, and the `DemoCheckout` table; it preserves cash records.
The UI labels all online options as demo, including on a production-hosted app.

Before real payments are introduced, use a provider checkout with verified
webhooks, real refunds, provider fees, and a separately authorized payout
integration. Demo results must never be treated as real payment verification.

## Verification

`node --test tests/payment-policy.test.mjs` checks currency rounding.
`RUN_DEMO_INTEGRATION=1 node tests/demo-payments.integration.cjs` runs transaction
and API checks in a disposable PostgreSQL schema, then drops only that schema.
It uses `BOOKING_TEST_DATABASE_URL`, falling back to the configured database,
without modifying application records. Never run database reset commands.
