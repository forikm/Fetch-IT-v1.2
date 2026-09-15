# Fetch-It — Deploy to Vercel

This PWA runs on **Next.js 16 + Prisma**. Locally it uses SQLite (no setup
needed), but on Vercel you need a serverless-friendly database because the
filesystem is read-only in serverless functions.

This guide covers the two easiest paths:

| Path | Difficulty | Free tier? | Best for |
|------|------------|-----------|----------|
| **A. Turso (SQLite-compatible)** | Easiest | ✅ | Demo / personal projects |
| **B. Vercel Postgres / Neon / Supabase** | Easy | ✅ | Production |

The WebSocket mini-service (real-time GPS) cannot run on Vercel's
serverless platform. The customer dashboard falls back to 6-second polling
automatically when the socket is unreachable, so the app keeps working.
See **"Real-time on Vercel"** at the bottom for production options.

---

## Step 1 — Push the project to GitHub

```bash
git init
git add .
git commit -m "Fetch-It initial commit"
git branch -M main
git remote add origin https://github.com/<you>/fetchit.git
git push -u origin main
```

## Step 2 — Import the project on Vercel

1. Visit https://vercel.com/new
2. Import the GitHub repo
3. Framework preset: **Next.js** (auto-detected)
4. Build command: `prisma generate && next build`
5. Install command: `bun install` (or `npm install`)
6. Don't deploy yet — add env vars first.

## Step 3 — Choose your database

### Path A: Turso (SQLite-compatible, simplest)

1. Sign up at https://turso.tech and create a database (free tier is enough).
2. Run `turso db tokens create <db-name>` to get an auth token.
3. In Vercel → Project → Settings → Environment Variables, add:
   - `DATABASE_URL` = `libsql://<db-name>-<your-org>.turso.io?authToken=<token>`
   - `SESSION_SECRET` = (any random 32-char string)

Then in **Vercel build settings**, change the build command to:
```
bunx prisma generate --schema=prisma/schema.postgres.prisma && bunx prisma db push --schema=prisma/schema.postgres.prisma --accept-data-loss && next build
```

> Wait — Turso uses libsql, not raw Postgres. For Turso, install the libsql
> Prisma adapter instead and keep the SQLite schema. See the **Turso + Prisma**
> docs: https://docs.turso.tech/prisma

### Path B: Vercel Postgres / Neon / Supabase (production-grade)

1. Provision a Postgres database. Vercel Postgres has a free tier
   (Storage tab → Connect Database).
2. Copy the `postgresql://...` connection string.
3. In Vercel → Project → Settings → Environment Variables, add:
   - `DATABASE_URL` = your Postgres connection string
   - `SESSION_SECRET` = (any random 32-char string)
4. Overwrite the Prisma schema with the Postgres variant:
   ```bash
   cp prisma/schema.postgres.prisma prisma/schema.prisma
   git commit -am "Switch Prisma datasource to Postgres" && git push
   ```
5. Set the build command on Vercel to:
   ```
   bunx prisma generate && bunx prisma db push --accept-data-loss && next build
   ```
   (Or run `bunx prisma db push` once locally with the same `DATABASE_URL`
   to create the tables.)

## Step 4 — Deploy

Click **Deploy** in Vercel. The build will:
1. `prisma generate` — compile the Prisma client
2. `next build` — build the Next.js app
3. Serve it on `https://<your-project>.vercel.app`

The first time the page loads, the `/api/auth/seed` endpoint auto-creates
two demo accounts so you can immediately try the customer and rider flows:
- `customer@fetchit.app` / `demo1234`
- `rider@fetchit.app` / `demo1234`

## Step 5 — Verify the PWA install

1. Open the deployed URL in Chrome on Android or Safari on iOS.
2. You should see an "Install" prompt in the browser — accept it to add
   Fetch-It to your home screen.
3. The app should open in standalone mode (no browser chrome).

---

## Real-time on Vercel (optional)

The bundled WebSocket mini-service (`mini-services/tracking-service`) is
**not** deployed to Vercel because Vercel serverless functions don't support
long-lived WebSocket connections. Three production options:

1. **Polling fallback (default)** — The customer tracking modal polls
   `/api/bookings/[id]` every 6 seconds. Works on Vercel out of the box,
   no extra services needed. Good enough for most demos.
2. **Pusher / Ably / PubNub** — Swap the `getTrackingSocket()` helper in
   `src/lib/socket.ts` for the Pusher/Ably client. Update the
   `rider:location` / `status:change` events to publish to a channel.
3. **Deploy the mini-service separately** — Run `mini-services/tracking-service`
   on Render.com, Fly.io, or Railway (free tiers exist), then set
   `NEXT_PUBLIC_WS_URL` to that host. The client already supports passing
   a custom URL via the gateway.

---

## Environment variables

| Variable | Required | Example | Notes |
|----------|----------|---------|-------|
| `DATABASE_URL` | ✅ | `postgresql://...` or `file:./dev.db` | SQLite locally, Postgres on Vercel |
| `SESSION_SECRET` | ✅ in prod | 32 random chars | Signs the session cookie HMAC |
| `NEXT_PUBLIC_WS_URL` | optional | `https://ws.example.com` | If hosting the WS service externally |

---

## Updating the schema on Vercel

After changing `prisma/schema.prisma`:

```bash
# Local: push the changes to your Vercel DB
bunx prisma db push --accept-data-loss
# Commit and push — Vercel re-runs `prisma generate` automatically via the
# postinstall hook in package.json.
```
