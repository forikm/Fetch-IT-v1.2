# Fetch-It Customer

On-demand **Delivery** (cargo) and **Ride** (passenger) booking for customers.
Next.js 16 · App Router · TypeScript · Tailwind CSS 4 · shadcn/ui · Prisma · PostgreSQL (Neon) · Vercel-ready PWA.

## What's inside

- **Landing page** — public storefront for both products.
- **Mode selector** — after logging in, the customer picks **Delivery** or **Ride**; the chosen experience opens (return to the selector with the Back button below the header).
- **Delivery dashboard** — 3-step cargo booking wizard (pickup → drop-off → details), Motor, Tricycle and Car vehicle choices, weight-based dynamic fares with surge, live tracking with OTP / signature / photo e-POD.
- **Ride dashboard** — the same 3-step booking wizard and dashboard as delivery, with passenger counts, ride fares and driver tracking.
- **Offline PWA** — reopen the previously loaded app, view saved active bookings/history with the last-update time, and edit persistent ride/delivery drafts using saved places. Cached customer views last up to seven days; sign-out clears that account’s local data. Reconnecting refreshes the account and bookings. Address search/maps, fare quotes, booking confirmation, tracking, receipts and support conversations require a connection; drafts are never sent automatically.
- Firebase email/password sign-up with email verification for new customers. Existing accounts and the demo account retain their legacy sign-in.
- Customer sign-up requires a valid Philippine phone number. Local numbers such as `09171234567` are stored as `+639171234567`; profile edits use the same validation. Email/password sign-in does not ask existing accounts to re-enter their phone.
- Demo seed accounts (`/api/auth/seed`) for instant trials.
- Help & Support — booking and account requests, two-way conversations, reopening,
  FAQs, and in-app reply alerts. See [docs/customer-support.md](docs/customer-support.md)
  for contact settings, coordinated migration rollout, and isolated integration checks.

## Firebase Spark setup (customer app only)

1. Create a project at [Firebase Console](https://console.firebase.google.com/) and keep it on the **Spark** plan. No billing account is needed for email/password authentication within Spark quotas. Do not enable Phone Authentication.
2. Open **Build → Authentication → Sign-in method** and enable **Email/Password**. In **Authentication → Settings → Authorized domains**, add your deployed customer PWA domain. Add `localhost` if it is absent for local testing.
3. In **Project settings → General**, add a **Web app**. Copy its `apiKey`, `authDomain`, `projectId`, and `appId` into the matching `NEXT_PUBLIC_FIREBASE_*` variables in `.env` and in your deployment environment.
4. In **Project settings → Service accounts**, generate a private key. Copy `project_id`, `client_email`, and `private_key` from the downloaded JSON into `FIREBASE_PROJECT_ID`, `FIREBASE_CLIENT_EMAIL`, and `FIREBASE_PRIVATE_KEY`. These are server-only secrets; never put them in `NEXT_PUBLIC_*`, Git, or the browser. Set a long `SESSION_SECRET` too.
5. Restart the app after editing `.env`. Sign up with a new email, open Firebase's verification message, return to the app, and click **I've verified my email**. The customer database record and booking session are created only after Firebase confirms the address.

Firebase's default verification email is handled by Firebase. The customer app does not need a separate email service, SMS service, Firebase database, for sending verification emails. Firebase proves the email/password identity; its UID is linked through `AuthIdentity` to an independent Fetch `User` ID and cookie session.

Firebase creates the email/password identity before verification is sent; the Fetch-It customer record is created after verification. If signup is interrupted, retry with the same email and password to resume an unverified identity and send verification again. A restored unverified account also offers **Send verification email**. Delivery failures show the actual connection or quota error, and the app only reports an email as sent after Firebase accepts the request. Profile-saving failures do not block verification delivery. Verified accounts use normal sign-in.

Run the signup regressions with `node --test tests/customer-signup*.test.mjs`. The SDK integration test uses a local REST fixture and does not create real Firebase users or send real emails.

Switching to an email app keeps signup open. Email, name, phone and verification progress are saved on the device for up to 24 hours so reopening the PWA resumes the form; passwords and tokens are never included. Firebase still proves the identity and verification status. The app checks verification when visible and on return, finishing signup automatically when the required phone number is present. Successful sign-in, logout, leaving the form with Back, and changing accounts clear saved progress. See [docs/firebase-email-delivery.md](docs/firebase-email-delivery.md) for sender branding and inbox placement.

The legacy demo account still uses **Try the demo customer account**. Existing customer accounts can use **Have a pre-Firebase Fetch-It account?** on sign-in. New Firebase sign-ups cannot reuse an email already present in the shared database; existing accounts need an explicit migration if you want to move them to Firebase later.

## Run locally

Use npm and the committed `package-lock.json` in all three apps. The duplicate Bun lockfiles were removed.

```bash
cp .env.example .env          # fill in DATABASE_URL + Google Maps key
npm install
npm run dev                   # http://localhost:3000
```

## Deploy to Vercel

1. Push this folder to a GitHub repo and import it in Vercel.
2. Set environment variables (Project → Settings → Environment Variables):
   - `DATABASE_URL` — the shared Neon PostgreSQL connection string.
   - `NEXT_PUBLIC_GOOGLE_MAPS_API_KEY` — a Maps/Places-enabled Google key.
3. Deploy. The build runs `prisma generate && next build` (no DB push on build).

## Database

Shared with the Fetch-It **Rider** and **Admin** apps — one PostgreSQL schema (`prisma/schema.prisma`), one `DATABASE_URL`. Bookings carry a `type` field (`DELIVERY` | `RIDE`) so a ride booked here appears in the rider job feed and the admin dashboard instantly.

### Phone-only tracking location

The customer-owned versioned migration includes the tracking `source` column.
Deploy it with `npm run db:deploy` as described in
[docs/database-rebuild.md](docs/database-rebuild.md); the old manual SQL patches
are no longer part of setup. The rider's ticket-based native location endpoint
writes `NATIVE`; the customer map shows only those updates. Accepting a job changes its status
but no longer creates or displays a pretend rider position. Until the phone
tracking app sends a location, the map says it is waiting for GPS.

Deploy the shared database migration before the coordinated app update. The native phone app still needs to
use the ticket-based endpoint to provide real location updates.

To sync the schema after changing `prisma/schema.prisma`:

```bash
# From fetch-customer (the canonical schema owner):
npm run db:sync
npm run db:deploy
# In each app:
npm run db:generate
```

## Demo accounts

Seeded automatically by the landing page (idempotent):

| Email | Password | Role |
|---|---|---|
| `customer@fetchit.app` | `demo1234` | CUSTOMER |

## Database rebuild

The canonical schema and versioned migrations live in fetch-customer. See [docs/database-rebuild.md](docs/database-rebuild.md) for account identities, rider records, delivery codes, GPS retention, and coordinated deployment. Set the same DELIVERY_CODE_SECRET in customer and rider environments. Configure CRON_SECRET in the rider deployment for daily tracking cleanup. External image storage is deferred.
