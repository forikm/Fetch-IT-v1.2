# Fetch-It Customer

On-demand **Delivery** (cargo) and **Ride** (passenger) booking for customers.
Next.js 16 · App Router · TypeScript · Tailwind CSS 4 · shadcn/ui · Prisma · PostgreSQL (Railway) · Vercel-ready PWA.

## What's inside

- **Landing page** — public storefront for both products.
- **Mode selector** — after logging in, the customer picks **Delivery** or **Ride**; the chosen experience opens (switchable anytime via "Switch mode").
- **Delivery dashboard** — 3-step cargo booking wizard (pickup → drop-off → details), vehicle classes from motorcycle to refrigerated van, weight-based dynamic fares with surge, live tracking with OTP / signature / photo e-POD.
- **Ride dashboard** — Grab-style "Where to?" panel, ride classes (motorcycle / tricycle / sedan) with upfront fares per class, passengers stepper, live driver tracking and trip history.
- Firebase email/password sign-up with email verification for new customers. Existing accounts and the demo account retain their legacy sign-in.
- Demo seed accounts (`/api/auth/seed`) for instant trials.

## Firebase Spark setup (customer app only)

1. Create a project at [Firebase Console](https://console.firebase.google.com/) and keep it on the **Spark** plan. No billing account is needed for email/password authentication within Spark quotas. Do not enable Phone Authentication.
2. Open **Build → Authentication → Sign-in method** and enable **Email/Password**. In **Authentication → Settings → Authorized domains**, add your deployed customer PWA domain. Add `localhost` if it is absent for local testing.
3. In **Project settings → General**, add a **Web app**. Copy its `apiKey`, `authDomain`, `projectId`, and `appId` into the matching `NEXT_PUBLIC_FIREBASE_*` variables in `.env` and in your deployment environment.
4. In **Project settings → Service accounts**, generate a private key. Copy `project_id`, `client_email`, and `private_key` from the downloaded JSON into `FIREBASE_PROJECT_ID`, `FIREBASE_CLIENT_EMAIL`, and `FIREBASE_PRIVATE_KEY`. These are server-only secrets; never put them in `NEXT_PUBLIC_*`, Git, or the browser. Set a long `SESSION_SECRET` too.
5. Restart the app after editing `.env`. Sign up with a new email, open Firebase's verification message, return to the app, and click **I've verified my email**. The customer database record and booking session are created only after Firebase confirms the address.

Firebase's default verification email is handled by Firebase. The customer app does not need a separate email service, SMS service, Firebase database, or database schema migration. Firebase credentials and the shared booking database are separate: Firebase proves the email/password identity; the existing PostgreSQL `User` record and cookie session continue to power bookings.

The legacy demo account still uses **Try the demo customer account**. Existing customer accounts can use **Have a pre-Firebase Fetch-It account?** on sign-in. New Firebase sign-ups cannot reuse an email already present in the shared database; existing accounts need an explicit migration if you want to move them to Firebase later.

## Run locally

```bash
cp .env.example .env          # fill in DATABASE_URL + Google Maps key
npm install
npm run dev                   # http://localhost:3000
```

## Deploy to Vercel

1. Push this folder to a GitHub repo and import it in Vercel.
2. Set environment variables (Project → Settings → Environment Variables):
   - `DATABASE_URL` — the **public** Railway PostgreSQL connection string (`postgresql://…rlwy.net:…/railway`).
   - `NEXT_PUBLIC_GOOGLE_MAPS_API_KEY` — a Maps/Places-enabled Google key.
3. Deploy. The build runs `prisma generate && next build` (no DB push on build).

## Database

Shared with the Fetch-It **Rider** and **Admin** apps — one PostgreSQL schema (`prisma/schema.prisma`), one `DATABASE_URL`. Bookings carry a `type` field (`DELIVERY` | `RIDE`) so a ride booked here appears in the rider job feed and the admin dashboard instantly.

### Phone-only tracking location

Before deploying the customer and rider tracking changes, run
[`prisma/add-tracking-source.sql`](prisma/add-tracking-source.sql) once in the
Neon SQL Editor for the shared database. It adds a non-destructive `source`
column with a `LEGACY` default, so older simulated updates cannot appear as
phone GPS. The rider's ticket-based native location endpoint writes `NATIVE`;
the customer map shows only those updates. Accepting a job changes its status
but no longer creates or displays a pretend rider position. Until the phone
tracking app sends a location, the map says it is waiting for GPS.

Do not deploy the updated customer and rider apps before this SQL change: their
tracking queries expect the new column. The native phone app still needs to
use the ticket-based endpoint to provide real location updates.

To sync the schema after changing `prisma/schema.prisma`:

```bash
npm run db:push
```

## Demo accounts

Seeded automatically by the landing page (idempotent):

| Email | Password | Role |
|---|---|---|
| `customer@fetchit.app` | `demo1234` | CUSTOMER |
