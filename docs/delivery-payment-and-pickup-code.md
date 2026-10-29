# Drop-off cash confirmation and pickup codes

Cash delivery flow: rider accepts → picks up → starts delivery → **I’m at drop-off** → customer confirms cash paid and rider confirms cash received → recipient signature → Delivered.

The payment controls are hidden on both apps until the assigned rider confirms arrival. Arrival is recorded as a `DROPOFF_REACHED` payment-history event under a booking row lock; it does not mark the job paid or delivered. The existing schema stores this audit, so no migration or new booking status is required. Arrival is a rider declaration, not a GPS proximity check. Both the status PATCH and signature-proof endpoint independently reject completion until arrival and matching full-fare confirmations exist. Supporting photo uploads do not complete a delivery. Online prepaid jobs do not ask riders to collect cash. Ride cash policy remains unchanged.

Payment reads include `dropoffReachedAt`. Visible payment cards poll every three seconds without overlapping requests; a local confirmation invalidates stale poll responses. The Rider payment card remounts on booking-stage changes. Old delivered cash bookings can still be settled, and staff-recorded Paid records can receive missing participant acknowledgments for the exact recorded fare. Staff can correct mismatches through the existing audited payment review flow.

The prior ride-code verifier used the app’s `DELIVERY_CODE_SECRET` or `SESSION_SECRET`, so Customer and Rider deployments with different secrets could reject identical digits. New codes keep Customer-side AES-GCM encryption and use a booking-bound, randomly salted scrypt verifier. Rider verification is independent of its session/encryption key. See [Node crypto scrypt documentation](https://nodejs.org/api/crypto.html#cryptoscryptsyncpassword-salt-keylen-options). Codes remain six digits with leading zeros, expire after 15 minutes, allow five attempts and become unusable after boarding. Booking ownership and rider-assignment checks are unchanged.

Refreshing a legacy unexpired Customer code upgrades its verifier while retaining digits, expiry and failed-attempt count. An undecryptable code after an encryption-key rotation is replaced without clearing failed attempts. The Customer UI provides **Refresh pickup code**. A Rider encountering an incompatible legacy code is instructed to ask the passenger to refresh; it does not falsely report mismatching digits or consume an attempt for that compatibility issue.

Shared payment helpers are kept in Customer, Rider, Admin and Superadmin so every app retains consistent settlement rules. The pickup helper is shared between Customer and Rider.

Validation:

```text
node --test tests/delivery-challenge.test.mjs tests/pickup-otp-upgrade.test.mjs tests/cash-delivery-wall.test.mjs tests/customer-payment-card.test.mjs tests/payment-policy.test.mjs
```

Also verified through two real localhost Next servers with distinct secrets and one isolated PostgreSQL schema: early confirmations rejected on both apps; unpaid signature and direct completion rejected; idempotent arrival visible to Customer; matching confirmations and signature complete exactly once; incorrect OTP increments attempts; correct Customer OTP boards the ride through Rider; a used code cannot be retrieved again. Synthetic test accounts only, with email delivery disabled.
