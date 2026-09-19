# Fetch-It Customer

On-demand **Delivery** (cargo) and **Ride** (passenger) booking for customers.
Next.js 16 · App Router · TypeScript · Tailwind CSS 4 · shadcn/ui · Prisma · PostgreSQL (Railway) · Vercel-ready PWA.

## What's inside

- **Landing page** — public storefront for both products.
- **Mode selector** — after logging in, the customer picks **Delivery** or **Ride**; the chosen experience opens (switchable anytime via "Switch mode").
- **Delivery dashboard** — 3-step cargo booking wizard (pickup → drop-off → details), vehicle classes from motorcycle to refrigerated van, weight-based dynamic fares with surge, live tracking with OTP / signature / photo e-POD.
- **Ride dashboard** — Grab-style "Where to?" panel, ride classes (motorcycle / tricycle / sedan) with upfront fares per class, passengers stepper, live driver tracking and trip history.
- Demo seed accounts (`/api/auth/seed`) for instant trials.

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

To sync the schema after changing `prisma/schema.prisma`:

```bash
npm run db:push
```

## Demo accounts

Seeded automatically by the landing page (idempotent):

| Email | Password | Role |
|---|---|---|
| `customer@fetchit.app` | `demo1234` | CUSTOMER |
