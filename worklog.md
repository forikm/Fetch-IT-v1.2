---
Task ID: fetchit-build
Agent: main
Task: Build Fetch-It — an automated logistics PWA with backend based on user's PDF brief, with customer and rider login buttons, deployable to Vercel.

Work Log:
- Read /home/z/my-project/upload/Fetch-it.pdf — extracted the product brief: instant/scheduled booking, dynamic fare estimator, real-time GPS tracking, route optimization, digital proof of delivery, automated matching engine.
- Loaded fullstack-dev skill and ran init-fullstack.sh; Next.js 16 + Prisma + shadcn/ui scaffold verified.
- Designed Prisma schema (User, Booking, TrackingUpdate, DeliveryProof) for SQLite locally; pushed with `bun run db:push`.
- Built pure-function utilities: src/lib/constants.ts (5 vehicle classes, surge multiplier), src/lib/fare.ts (haversine + fare breakdown + ETA + ref code + OTP), src/lib/password.ts (scrypt-based hashing), src/lib/session.ts (HMAC-signed cookie session, no external deps), src/lib/matching.ts (nearest online rider matching by vehicle class).
- Auth APIs: signup, login, me, logout, seed (demo accounts: customer@fetchit.app, rider@fetchit.app, both password demo1234).
- Booking APIs: GET/POST list/create, GET/PATCH by id, /match, /tracking GET+POST, /otp GET, /proof POST, /cancel POST.
- Rider APIs: /available, /location, /status, /stats.
- Fare API: /api/fare/estimate (distance, surge, fare breakdown, ETA).
- WebSocket mini-service at mini-services/tracking-service on port 3003 (in-memory pub/sub for booking:<id> channel; events: rider:location, status:change, proof:complete).
- Frontend (all client-side; only the `/` route per sandbox rules):
  * src/lib/store.ts (Zustand: user, view, pendingRole, bootstrap, logout, refreshUser)
  * src/lib/socket.ts (lazy-loaded socket.io-client with XTransformPort=3003)
  * src/components/fetchit/shared/logo.tsx, status-badge.tsx, landing.tsx, auth-view.tsx, signature-pad.tsx, sw-register.tsx
  * src/components/fetchit/customer/customer-dashboard.tsx (booking list, booking form with live fare estimate, tracking modal with mini SVG map + socket subscription + 6s polling fallback + OTP reveal + e-POD viewer)
  * src/components/fetchit/rider/rider-dashboard.tsx (stats header, online toggle, available feed with auto-refresh, active job modal with status stepper + simulated GPS broadcasting + signature/OTP/photo e-POD capture)
- Custom amber/orange Tailwind palette (avoiding indigo/blue per skill rules); added bg-grid + animate-fit-pulse + animate-route-dash utilities.
- PWA: public/manifest.webmanifest, public/sw.js (network-first HTML + SWR static), public/icon-192.png + icon-512.png + apple-touch-icon.png + icon.svg (generated via scripts/generate-pwa-icons.ts with node-canvas).
- Vercel: vercel.json (build = prisma generate && next build), prisma/schema.postgres.prisma (drop-in Postgres schema), DEPLOY-VERCEL.md (Turso + Postgres paths documented), package.json postinstall hook for prisma generate.
- Fixed bugs:
  * Removed `Van` icon (not in lucide-react) — replaced with `Truck` for CLOSED_VAN.
  * Fixed `vehicleClass: { not: null }` filter (Prisma refuses since the column is NOT NULL) — removed the filter.
  * Fixed socket.io-client missing dep — `bun add socket.io-client`.
  * Fixed signature pad `Cannot access refs during render` ESLint error — moved stroke state to useState.
  * Fixed JSX stray comment for img tags.
- Self-verified with agent-browser:
  * Landing page renders with both persona login cards + demo buttons.
  * Demo customer login → dashboard → new booking modal with auto fare estimate → confirm booking → booking shows "Rider matched" automatically.
  * Tracking modal shows rider name, plate, rating, pickup/dropoff, OTP reveal button (when accepted), e-POD viewer when delivered.
  * Demo rider login → dashboard with stats (active/completed/rating/earnings) + online toggle.
  * Rider accepted a job → status stepper progressed Rider en route → Picked up → In transit → Delivered. Earnings updated to $45.25, completed count → 1.
  * Customer history view shows the delivered booking with "View proof" → e-POD card (OTP verified, Signature verified).
  * Browser console: clean (no errors).

Stage Summary:
- Artifact: full Next.js 16 PWA at /home/z/my-project with backend (15 API routes) + WebSocket service + Prisma schema + PWA manifest/service worker + Vercel deployment config + DEPLOY-VERCEL.md.
- Demo accounts: customer@fetchit.app / demo1234 and rider@fetchit.app / demo1234 (auto-seeded on first page load via /api/auth/seed).
- Browser-verified: full customer→booking→match→rider-accept→deliver→proof loop works end-to-end with no runtime errors.
- Ready to deploy on Vercel: push to GitHub → import on Vercel → set DATABASE_URL to Postgres or Turso connection string → deploy. See DEPLOY-VERCEL.md for step-by-step.
