# Shared Fetch database

The customer, rider, and admin apps share one Neon PostgreSQL database. The
canonical schema and migrations live in `fetch-customer/prisma`. Schema and
shared helper copies remain checked in to the other apps for independent builds.

## Structure

- `User`: stable Fetch ID, normalized unique email, name, phone, one account role,
  and restriction information. Roles cannot change in place; create a separate
  account for a different role.
- `AuthIdentity`: provider and provider ID, with unique provider/identity and
  user/provider pairs. Firebase IDs are independent of Fetch user IDs. Password
  hashes exist only for PASSWORD identities. Customer Firebase accounts are never
  linked to a password account by email alone.
- `RiderProfile`: vehicle, rating summary, and completed booking counter.
- `RiderPresence`: online status and latest rider coordinates, separate from the
  account. Rider records require a RIDER account.
- `Booking`: customer/rider relations, ride or delivery, route, dates, and quoted
  fares stored as Decimal(12,2). Money is converted to JSON numbers at the API
  boundary for the existing clients. Quotes remain snapshots of the agreed fare.
- `BookingEvent`: actor/name/role snapshots, old/new statuses, assignment, time,
  and cancellation reason, committed in the same transaction as the change.
- `BookingLocation`: latest native location for one booking, updated on every
  location publication. The live map uses this instead of sampled history.
- `TrackingUpdate`: at most one saved native point per booking per 30 seconds.
- `DeliveryChallenge`: booking-bound encrypted code plus keyed hash, 15-minute
  expiry, five-attempt limit, and verification timestamp. Failed attempts commit;
  verification, proof, completion, counter, and event save atomically.
- `DeliveryProof`: OTP verification evidence, signature, or photo. No codes are
  exposed through the booking/proof API. A photo alone does not complete a job.
- `CustomerReview`: one review per completed booking, rating constrained to 1–5,
  and owner/rider checked against that booking.
- `SupportTicket`, `SupportMessage`, `AdminAudit`, `TicketCounter`: retained.
  Replies live in messages; the customer support detail API returns the two-way
  conversation instead of storing a second copy of replies. Support messages and audit entries keep
  author-name snapshots even if their author is removed.

PostgreSQL enums, checks, foreign keys, and role/ownership triggers enforce
validity across the three applications. Composite indexes follow customer
history, rider jobs, available jobs, and tracking-history queries.

## Commands and deployment

From fetch-customer:

```powershell
npm run db:sync
npm run db:check
npm run db:deploy
```

Generate the Prisma client in each app after schema changes. Only fetch-customer
owns and deploys migrations; do not use `db push` or the old manual SQL patches
with this schema. The initial migration is for a fresh database, not an upgrade
script for old production data.

The explicitly authorized test reset is gated:

```powershell
$env:ALLOW_TEST_DATABASE_RESET = '1'
npm run db:reset:test
Remove-Item Env:\ALLOW_TEST_DATABASE_RESET
```

It verifies the three local DATABASE_URL targets match, clears non-admin accounts
and all booking data, and recreates existing admin password logins. Firebase Auth
accounts are unaffected: the next verified sign-in creates a new Fetch account.
Old Fetch session cookies must be cleared by signing out and back in.

Deploy all three apps with the matching schema. Configure the **same** random
`DELIVERY_CODE_SECRET` in customer and rider deployment environments. Separate
SESSION_SECRET values remain supported. The local `.env` files have been
configured; deployment settings are not updated by editing those files.

## GPS retention

Detailed history and latest booking coordinates are removed 30 days after a
booking finishes (deliveredAt or cancelledAt). Active bookings, booking records,
proofs, reviews, and events are retained. The rider app includes a daily Vercel
cron at `/api/maintenance/tracking`, guarded by CRON_SECRET. Set CRON_SECRET in
the rider deployment to activate authenticated cleanup. On other hosts schedule
the customer app's `npm run tracking:cleanup` daily. The endpoint refuses to run
without its secret. This schedule is repository configuration; it takes effect
after deployment.

## Deliberately deferred

No Supabase or other external image service is configured. Existing inline photo
storage remains bounded to 200,000 characters per photo; the rider file picker
allows 140 KB photos to account for base64 overhead. Signatures are bounded too.
This is temporary storage, not the completed file-storage migration.

Saved places remain device-local. No multi-role accounts, payment ledger,
commission calculation, or rider payout records are introduced. The dashboard
earnings figure remains the sum of completed quoted fares.
