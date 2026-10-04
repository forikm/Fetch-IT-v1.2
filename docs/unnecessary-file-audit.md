# Fetch-It file cleanup audit

Inspected customer, admin, and rider checkouts on 4 October 2026. No project files were deleted and no application code, dependencies, database, or Git history was changed.

## Findings

- 13 source files have no incoming imports and are not framework entry files: 7 customer and 6 rider files.
- 21 public image/SVG files have no references in the inspected code, CSS, manifests, service workers, scripts, tests, or project documentation: 15 customer and 6 rider files.
- 2 admin helper files are unused by the admin app but are required by the shared-file synchronization policy.
- 5 manual SQL patches belong to the old database setup. Current deployment uses the customer-owned versioned migration.
- Customer presentation temporary files and logo production sources are separate from runtime assets.
- Both customer and rider declare 25 dependency packages with no direct imports or configuration references in the inspected project files. These are package cleanup candidates, not files to manually remove from node_modules.

## How this was checked

A TypeScript parser extracted static imports, re-exports, require calls, and literal dynamic imports. Next.js pages, layouts, API routes, loading screens and other standard entry conventions were treated as entry files. Imports were resolved using the current @/ alias and relative paths. Public assets were checked against source text, CSS, manifests, service workers, scripts, tests, configuration and documentation. Binary hashes found no byte-identical duplicate assets within each public folder.

These are local static-analysis findings. External clients, bookmarks, deployment health checks and dynamically constructed asset paths may not be visible in the repositories. Such public URLs need a usage check before removal. Private .env values were not read. No database integration tests were run because this was an inspection and those tests create records.

## Unused source files

All files below have zero incoming imports in the inspected source files and no path from the Next.js entry files. Removing them should not change the current interface, assuming no external tooling references them. Run a TypeScript check and production build after a cleanup.

| Project | File | Finding |
| --- | --- | --- |
| fetch-customer | [src/components/ui/separator.tsx](<../src/components/ui/separator.tsx>) | No importer; unused UI component or mobile hook |
| fetch-customer | [src/components/ui/sheet.tsx](<../src/components/ui/sheet.tsx>) | No importer; unused UI component or mobile hook |
| fetch-customer | [src/components/ui/skeleton.tsx](<../src/components/ui/skeleton.tsx>) | No importer; unused UI component or mobile hook |
| fetch-customer | [src/components/ui/switch.tsx](<../src/components/ui/switch.tsx>) | No importer; unused UI component or mobile hook |
| fetch-customer | [src/components/ui/toggle.tsx](<../src/components/ui/toggle.tsx>) | No importer; unused UI component or mobile hook |
| fetch-customer | [src/components/ui/tooltip.tsx](<../src/components/ui/tooltip.tsx>) | No importer; unused UI component or mobile hook |
| fetch-customer | [src/hooks/use-mobile.ts](<../src/hooks/use-mobile.ts>) | No importer; unused UI component or mobile hook |
| fetch-rider | [src/components/ui/separator.tsx](<https://github.com/aldoususer/Fetch-IT-Rider/blob/main/src/components/ui/separator.tsx>) | No importer; unused UI component or mobile hook |
| fetch-rider | [src/components/ui/sheet.tsx](<https://github.com/aldoususer/Fetch-IT-Rider/blob/main/src/components/ui/sheet.tsx>) | No importer; unused UI component or mobile hook |
| fetch-rider | [src/components/ui/switch.tsx](<https://github.com/aldoususer/Fetch-IT-Rider/blob/main/src/components/ui/switch.tsx>) | No importer; unused UI component or mobile hook |
| fetch-rider | [src/components/ui/toggle.tsx](<https://github.com/aldoususer/Fetch-IT-Rider/blob/main/src/components/ui/toggle.tsx>) | No importer; unused UI component or mobile hook |
| fetch-rider | [src/components/ui/tooltip.tsx](<https://github.com/aldoususer/Fetch-IT-Rider/blob/main/src/components/ui/tooltip.tsx>) | No importer; unused UI component or mobile hook |
| fetch-rider | [src/hooks/use-mobile.ts](<https://github.com/aldoususer/Fetch-IT-Rider/blob/main/src/hooks/use-mobile.ts>) | No importer; unused UI component or mobile hook |

The rider skeleton.tsx is actively imported by rider-dashboard.tsx and must stay. Toast, toaster and use-toast are actively used in both apps and must stay.

## Unreferenced public assets

These are earlier logo/icon variants or default assets. Archive design originals if you want to preserve them. The absence of repository references does not prove that nobody has bookmarked their public URLs.

| Project | File | Size |
| --- | --- | --- |
| fetch-customer | [public/apple-touch-icon.png](<../public/apple-touch-icon.png>) | 5,380 bytes |
| fetch-customer | [public/favicon-32.png](<../public/favicon-32.png>) | 857 bytes |
| fetch-customer | [public/fetch-icon-192.png](<../public/fetch-icon-192.png>) | 33,743 bytes |
| fetch-customer | [public/fetch-icon-512.png](<../public/fetch-icon-512.png>) | 199,232 bytes |
| fetch-customer | [public/fetch-icon-clean-192.png](<../public/fetch-icon-clean-192.png>) | 38,166 bytes |
| fetch-customer | [public/fetch-icon-clean-512.png](<../public/fetch-icon-clean-512.png>) | 244,456 bytes |
| fetch-customer | [public/fetch-icon-v2-192.png](<../public/fetch-icon-v2-192.png>) | 46,482 bytes |
| fetch-customer | [public/fetch-icon-v2-512.png](<../public/fetch-icon-v2-512.png>) | 293,547 bytes |
| fetch-customer | [public/fetch-logo-clean.png](<../public/fetch-logo-clean.png>) | 542,402 bytes |
| fetch-customer | [public/fetch-logo-transparent.png](<../public/fetch-logo-transparent.png>) | 636,767 bytes |
| fetch-customer | [public/fetch-logo.jpg](<../public/fetch-logo.jpg>) | 50,470 bytes |
| fetch-customer | [public/icon-192.png](<../public/icon-192.png>) | 5,984 bytes |
| fetch-customer | [public/icon-512.png](<../public/icon-512.png>) | 22,008 bytes |
| fetch-customer | [public/icon.svg](<../public/icon.svg>) | 471 bytes |
| fetch-customer | [public/logo.svg](<../public/logo.svg>) | 1,065 bytes |
| fetch-rider | [public/apple-touch-icon.png](<https://github.com/aldoususer/Fetch-IT-Rider/blob/main/public/apple-touch-icon.png>) | 5,380 bytes |
| fetch-rider | [public/favicon-32.png](<https://github.com/aldoususer/Fetch-IT-Rider/blob/main/public/favicon-32.png>) | 857 bytes |
| fetch-rider | [public/icon-192.png](<https://github.com/aldoususer/Fetch-IT-Rider/blob/main/public/icon-192.png>) | 5,984 bytes |
| fetch-rider | [public/icon-512.png](<https://github.com/aldoususer/Fetch-IT-Rider/blob/main/public/icon-512.png>) | 22,008 bytes |
| fetch-rider | [public/icon.svg](<https://github.com/aldoususer/Fetch-IT-Rider/blob/main/public/icon.svg>) | 471 bytes |
| fetch-rider | [public/logo.svg](<https://github.com/aldoususer/Fetch-IT-Rider/blob/main/public/logo.svg>) | 1,065 bytes |

Keep customer fetch-logo-final.png, fetch-loading.gif, fetch-icon-final-192.png and fetch-icon-final-512.png: the interface, metadata, manifest or service worker references them. Keep rider-logo.png and all rider-prefixed icons: the rider metadata, manifest and service worker reference them. Keep the admin fetch-logo-final.png.

Keep robots.txt in customer and rider even though it has no code import. Search engines request it directly. Keep manifest.webmanifest and sw.js in both apps.

## Generated caches and authoring files

| Project | Folder | Size | Recommendation |
| --- | --- | --- | --- |
| fetch-customer | `tmp/` | 46.8 MiB | Authoring renders, candidates and audit work; archive or remove after retaining desired source files. |
| fetch-customer | `output/` | 6.9 MiB | Logo animation production files; archive outside the deployed app if no longer editing the animation. |
| fetch-customer | `.next/` | 542.5 MiB | Generated build cache; can rebuild. Stop the app before clearing it. |
| fetch-customer | `node_modules/` | 977.2 MiB | Installed dependencies; keep for normal development. Reinstall with the chosen package manager if removed. |
| fetch-admin | `.next/` | 377.4 MiB | Generated build cache; can rebuild. Stop the app before clearing it. |
| fetch-admin | `node_modules/` | 661.5 MiB | Installed dependencies; keep for normal development. Reinstall with the chosen package manager if removed. |
| fetch-rider | `.next/` | 170.4 MiB | Generated build cache; can rebuild. Stop the app before clearing it. |
| fetch-rider | `node_modules/` | 795.0 MiB | Installed dependencies; keep for normal development. Reinstall with the chosen package manager if removed. |

The three .next folders total 1,090.3 MiB. They occupy local disk space and are not unnecessary application source code. Each tsconfig.tsbuildinfo is also a regenerable compiler cache.

Customer output/cap-fall includes animation scripts, source images and draft GIF/WebP exports. The app uses public/fetch-loading.gif, not output/cap-fall. Preserve that runtime GIF and archive the production sources if you want to edit the animation later.

The final PowerPoint and PDF files are already in Downloads/not related to fetch. Copies and slide renders under tmp/presentations are temporary authoring material. This report and its inspection script were created during the audit; their small sizes were not part of the original temporary-folder measurement.

## Files needing a coordinated decision

| Files | Finding | Recommendation |
| --- | --- | --- |
| [src/lib/delivery-challenge.ts](<https://github.com/40kilometer/Fetch-IT-Admin/blob/main/src/lib/delivery-challenge.ts>); [src/lib/ticket.ts](<https://github.com/40kilometer/Fetch-IT-Admin/blob/main/src/lib/ticket.ts>) | No admin source imports, but customer scripts/sync-shared.cjs requires and recreates these copies | Keep under the present sync policy; change the per-app sync list before removing them |
| [tailwind.config.ts](<../tailwind.config.ts>); [tailwind.config.ts](<https://github.com/aldoususer/Fetch-IT-Rider/blob/main/tailwind.config.ts>) | Older config files; current CSS imports Tailwind v4 and tw-animate-css, and has no @config directive | Candidates for removal together with tailwindcss-animate after a build check; keep the active PostCSS and globals.css files |
| [tests/operations.integration.cjs](<https://github.com/40kilometer/Fetch-IT-Admin/blob/main/tests/operations.integration.cjs>) | Creates User.passwordHash and writes SupportTicket.adminReply, fields removed from the current Prisma models | Update the test to AuthIdentity and support messages, or archive it as a legacy test; preserve relevant test coverage |
| [src/app/api/route.ts](<../src/app/api/route.ts>); [src/app/api/route.ts](<https://github.com/aldoususer/Fetch-IT-Rider/blob/main/src/app/api/route.ts>) | GET /api returns only Hello, world; no local fetch caller found | Optional cleanup if no deployment health check or external client uses it |
| [src/app/api/auth/signup/route.ts](<../src/app/api/auth/signup/route.ts>) | Rejects CUSTOMER signup but still creates RIDER accounts; no current customer interface caller found | Review whether the customer deployment should expose rider signup before removing; it is executable behavior, not a dead stub |
| bun.lock in all three repos | package-lock.json also exists, and README instructions use npm | Choose the package manager first; keep package-lock.json for npm, and remove bun.lock only if Bun is not used in development or deployment |

Historical SQL patches:

- fetch-customer: [prisma/add-admin-operations.sql](<../prisma/add-admin-operations.sql>)
- fetch-customer: [prisma/add-customer-features.sql](<../prisma/add-customer-features.sql>)
- fetch-customer: [prisma/add-tracking-source.sql](<../prisma/add-tracking-source.sql>)
- fetch-admin: [prisma/add-admin-operations.sql](<https://github.com/40kilometer/Fetch-IT-Admin/blob/main/prisma/add-admin-operations.sql>)
- fetch-rider: [prisma/add-admin-operations.sql](<https://github.com/aldoususer/Fetch-IT-Rider/blob/main/prisma/add-admin-operations.sql>)

The customer README still tells readers to apply add-tracking-source.sql, and docs/customer-improvements.md still describes applying add-customer-features.sql. Update those instructions when archiving these old patches. The current database-rebuild guide and admin README say not to apply old SQL to the rebuilt schema.

Keep prisma/schema.prisma in all three apps, and keep customer prisma/migrations/202610040001_shared_database_rebuild/migration.sql and migration_lock.toml. Matching schemas and shared helpers are intentional copies supporting separate deployments.

## Dependency cleanup candidates

Customer and rider share this same list of 25 packages with no direct imports or configuration references found. Remove them through the package manager, which updates package.json and its lockfile, rather than deleting package directories manually.

- `@radix-ui/react-accordion`
- `@radix-ui/react-alert-dialog`
- `@radix-ui/react-aspect-ratio`
- `@radix-ui/react-checkbox`
- `@radix-ui/react-collapsible`
- `@radix-ui/react-context-menu`
- `@radix-ui/react-hover-card`
- `@radix-ui/react-menubar`
- `@radix-ui/react-navigation-menu`
- `@radix-ui/react-popover`
- `@radix-ui/react-progress`
- `@radix-ui/react-radio-group`
- `@radix-ui/react-scroll-area`
- `@radix-ui/react-slider`
- `@radix-ui/react-toggle-group`
- `cmdk`
- `embla-carousel-react`
- `input-otp`
- `next-themes`
- `react-day-picker`
- `react-hook-form`
- `react-resizable-panels`
- `recharts`
- `sonner`
- `vaul`

After removing the unused separator, switch, toggle and tooltip wrappers, their four Radix dependencies become further candidates: @radix-ui/react-separator, @radix-ui/react-switch, @radix-ui/react-toggle and @radix-ui/react-tooltip. Removing sheet alone does not make @radix-ui/react-dialog unused: dialog.tsx still uses it.

Do not infer that react-dom, Prisma CLI or sharp are unnecessary just because application code does not import them directly. Framework/runtime integration and build commands use packages outside ordinary source imports. Admin Recharts is actively used, even though customer and rider Recharts is not. Socket.IO client is dynamically imported in customer and rider, so keep it unless intentionally removing that optional feature.

## Suggested cleanup order

1. Archive authoring material, preserving the final PPT/PDF and active public/fetch-loading.gif.
2. Remove the 13 unused UI/hook source files and archive the 21 unreferenced assets after checking public URL use.
3. Remove the confirmed unused package declarations through npm if npm is the chosen manager.
4. Coordinate changes to shared-helper sync, old SQL documentation, old tests, and optional endpoints.
5. Run TypeScript checks separately and build all three apps. Customer/rider next.config.ts ignores TypeScript build errors, so a production build alone is not enough. Smoke-check login, customer booking/tracking, rider map and proof capture, admin charts/support, and PWA icons.

No cleanup has been performed. This report identifies candidates and records the evidence needed for a later cleanup.
