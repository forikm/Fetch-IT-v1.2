# Fetch-It demo payments

This feature simulates payment to Fetch-It, completed-booking commission and
rider earnings, and an admin-reviewed payout. It has no payment-provider
integration, requires no wallet or bank credentials, and never moves money.

Customer payment options are cash (the existing real cash-confirmation flow),
GCash, Maya, and bank account. Online requests save a separate `CheckoutDraft`
with a validated server quote and a 20-minute expiry. No booking, booking
reference, or tracking ticket exists until payment succeeds. The checkout uses
a normal Pay button with a small "Test payment — no money charged" notice.
Failure testing is available under Testing options. Failed or cancelled attempts
create no booking and can be retried with a new immutable payment attempt.
Closing checkout leaves it pending; submitting the same saved request resumes
that checkout. Payment-method selection and request details persist on the device.
Expired quotes require reviewing the request again.

Payment success creates the paid booking and tracking ticket atomically, with
one booking per customer-scoped request key. Duplicate or lost responses return
the same booking; client amounts and return URLs cannot verify payment.
Existing unpaid demo bookings remain hidden from the jobs board until checkout
succeeds. Assignment and acceptance also enforce this on the server. Paid bookings
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

Admin booking details show commission, rider earnings, and payout state.
For a completed, paid demo booking, submit a reference and review note to record
one simulated payout. It is an accounting record only, not a transfer. Retries
with the same reference do not duplicate it. A demo payout cannot be recorded
before completion or after refund. A completed paid demo booking can be
simulated as refunded before its payout, clearing its earnings. Cancelling an
active demo booking closes checkout and records a simulated refund if paid.

Rider stats display demo earnings, awaiting review, and simulated payouts
separately from completed cash fares. Admin confirmed cash collections exclude
test payments. Receipts and payment cards retain a small test-payment notice.

## Database and deployment

1. From `fetch-customer`, run `npm run db:sync` and `npm run db:deploy`.
2. Build and deploy customer, rider, and admin together with the shared schema.
3. Optionally set `DEMO_COMMISSION_PERCENT` on the customer deployment before
   creating new demo bookings. No API keys, business registration, or TIN are
   needed for this local simulation.

Only `fetch-customer` owns and deploys migrations. This adds enum values, demo
accounting fields, and the `DemoCheckout` table; it preserves cash records.
The second migration adds `CheckoutDraft` and lets a checkout belong to either
a draft or an existing booking. Legacy bookings and payment attempts are preserved.
The UI uses ordinary payment-method names and small test-payment notices,
including on a production-hosted app. Receipts retain an explicit test identifier.

Before real payments are introduced, use a provider checkout with verified
webhooks, real refunds, provider fees, and a separately authorized payout
integration. Demo results must never be treated as real payment verification.

## Verification

`node --test tests/payment-policy.test.mjs` checks currency rounding.
`RUN_DEMO_INTEGRATION=1 node tests/demo-payments.integration.cjs` runs transaction
and API checks in a disposable PostgreSQL schema, then drops only that schema.
It uses `BOOKING_TEST_DATABASE_URL`, falling back to the configured database,
without modifying application records. Never run database reset commands.
