# Booking and account protections

Implemented across customer, rider and admin without adding services or upgrading plans.
Normal hosting/database usage still counts toward the existing quotas. These controls
reduce avoidable traffic; they do not guarantee capacity for 1,000 simultaneous users.

## Limits

The shared PostgreSQL `RateLimitBucket` table stores atomic fixed-window quotas.
Each application instance uses the same counters. Keys are HMAC hashes of the
scope/account or address: the table does not store raw emails or IP addresses.
Rejected requests return HTTP 429 and `Retry-After` seconds.

| Operation | Limit | Scope |
| --- | --- | --- |
| Password login | 15 attempts / 15 minutes | Email, per app |
| Password login | 120 attempts / 15 minutes | IP, per app |
| Legacy rider signup | 10 attempts / hour | IP, per app |
| Firebase cookie exchange | 120 attempts / 15 minutes | IP |
| Create booking | 30 attempts / 5 minutes | Customer |
| Create support request or reply | 30 attempts / 5 minutes | Customer |
| Change booking status | 60 attempts / minute | Rider |
| Submit delivery proof | 20 attempts / 5 minutes | Rider |
| Publish native booking GPS | 90 attempts / minute | Rider |
| Update rider presence GPS | 90 attempts / minute | Rider |

Login quotas count successful attempts too. A booking replay already committed with
the same request key returns the existing booking before consuming another quota.
The existing delivery-code five-attempt lockout remains separate.

Vercel overwrites `X-Forwarded-For`; IP limits trust that header only on Vercel.
Other hosts use a shared `local` bucket until a trusted-proxy strategy is configured.
The protected rider maintenance cron and manual `npm run tracking:cleanup` remove
up to 5,000 expired buckets per run. This is request throttling, not protection
against a large network-level denial-of-service attack.

## Privacy, sessions and polling

Before acceptance, PENDING and MATCHED rider jobs expose the route, fare and generic
customer label. Customer identity, phone, free-text notes and encoded tracking
tickets are removed. The assigned rider receives contact details and the tracking
ticket after acceptance. Unrelated riders cannot fetch private booking/ticket data.

Production refuses missing/short session secrets and known sample/development
values. Signatures use constant-time comparison; malformed and expired payloads
are rejected. Rider/admin production cookies are Secure, HttpOnly and SameSite=Lax.
New password signup uses 15–128 characters. Existing passwords still work for login.
The Firebase customer form enforces this signup rule; the Firebase project password
policy must also be set in Firebase Console to enforce it on direct SDK/API signup.
Set minimum length 15, maximum length 128, and leave force upgrade on sign-in off
to preserve existing account access. The console policy has not been changed by
this code update. See [Firebase's password policy documentation](https://firebase.google.com/docs/auth/web/password-auth#recommended_set_a_password_policy).

Customer booking polling uses three seconds while bookings are active and thirty
seconds when idle. Customer and rider job polling pause while hidden/offline,
avoid overlapping requests, back off after errors (up to sixty seconds), and refresh
on return. The rider available-job feed retains its normal ten-second interval.

Important mutation responses include `X-Request-ID`. Their JSON logs include
operation, method, status, duration and safe error codes. Responses use private,
no-store caching. Logs omit request bodies, email/phone, GPS, passwords, cookies,
tokens and database URLs. Prisma query logging is disabled in all three apps.

## Deployment

1. Add the generated settings from the ignored `local-security-setup.json` to
   Vercel Project → Settings → Environment Variables:
   - Rider project: `rider.SESSION_SECRET` as `SESSION_SECRET`.
   - Admin project: `admin.ADMIN_SESSION_SECRET` as `ADMIN_SESSION_SECRET`.
   Apply them to each environment you will deploy. The local `.env` files already
   contain these values; Vercel settings still require the project owner to enter them.
2. Keep the customer project's existing strong `SESSION_SECRET` and the existing
   shared `DELIVERY_CODE_SECRET`. Confirm rider `CRON_SECRET` remains configured.
   Replacing a session secret signs out existing sessions in that app.
3. From fetch-customer, run `npm run db:deploy`. The new migration adds only the
   quota table and its index/check; it does not reset accounts or bookings.
4. Deploy all three apps. Builds regenerate their Prisma clients. Do not deploy
   code requiring the quota table before the migration completes.
5. Check login, booking, rider acceptance and a normal customer retry. Quota
   tests belong in the temporary-schema integration harness, not production.

Secrets and backups stay ignored by Git. Do not paste them into commits, chat
messages or screenshots. No paid Vercel/Neon/Firebase features are required here.

## Encrypted backups and restore checks

From fetch-customer:

```powershell
node scripts/database-backup.cjs create
node scripts/database-backup.cjs restore-test local-backup-<timestamp>.enc
```

The first command creates an AES-256-GCM encrypted application-data snapshot and
ignored `local-backup-key.json`. Preserve the key separately from the backup in a
private location; losing the key prevents recovery. Both files on the same computer
are not an off-device backup. Copy the encrypted file and key to separate private
storage before relying on them for machine-loss recovery.

The restore drill migrates a newly named temporary schema, imports the snapshot,
compares every saved table, and removes only that temporary schema. It never resets
or restores into the configured application schema. Rate-limit buckets are transient
and excluded. Firebase Auth accounts and deployment settings are external and not
included. This is a manual application-data backup, not a provider-managed backup
or an automatic backup schedule. Take another snapshot before schema changes and
repeat periodically as needed. A live disaster recovery operation needs a separate
database and a deliberate cutover; the script only performs safe restore drills.

## Verification

```powershell
node --test tests/*.test.mjs
$env:RUN_DATABASE_INTEGRATION='1'
node tests/database-rebuild.integration.cjs
Remove-Item Env:\RUN_DATABASE_INTEGRATION
$env:RUN_BOOKING_INTEGRATION='1'
node tests/booking-flow.integration.cjs
Remove-Item Env:\RUN_BOOKING_INTEGRATION
```

Integration checks start local production builds from all three sibling checkouts.
They use a fresh temporary schema, strong temporary session secrets and disposable
actors. They verify ownership, private pending/matched feeds, competing rider claims,
cancel/pickup and completion/cancellation races, delivery-code locks/replays, safe
logs, concurrent login limits and quota cleanup. The booking check also queues six
bookings behind a busy counter and sends ten parallel submissions. These are bounded
regressions, not a claim that 1,000 active users have been load tested.
