# Fetch-It cleanup results

Applied on 4 October 2026 after inspecting customer, admin and rider. The original file-by-file audit remains in [Git history](https://github.com/forikm/Fetch-IT-v1.2/blob/c8f45f76eaebaf400f3d050ddced1276c3ca7aae/docs/unnecessary-file-audit.md).

## Applied changes

| Change | Customer | Admin | Rider |
| --- | ---: | ---: | ---: |
| Unused UI components and mobile hooks removed | 7 | 0 | 6 |
| Unreferenced image/SVG variants removed | 15 | 0 | 6 |
| Obsolete manual SQL patches removed | 3 | 1 | 1 |
| Unused shared helper copies removed | 0 | 2 | 0 |
| Old Tailwind config removed | 1 | 0 | 1 |
| Duplicate Bun lockfile removed | 1 | 1 | 1 |
| Unused package declarations removed | 30 | 0 | 30 |

This removes 46 tracked files. npm pruned 69 installed packages in each of customer and rider, including transitive dependencies, and updated their package-lock.json files.

Customer removed separator, sheet, skeleton, switch, toggle, tooltip and use-mobile. Rider removed the same items except skeleton, which rider-dashboard still uses. Current toast components remain.

Customer's active assets are fetch-logo-final.png, fetch-loading.gif, fetch-icon-final-192.png and fetch-icon-final-512.png. Rider retains rider-logo.png and rider-prefixed icons. Admin retains its current logo. Each app retains the assets it references. No byte-identical public asset duplicates were found; the removed files were unreferenced older variants or template assets.

Both customer and rider now use their Tailwind v4 globals.css and PostCSS plugin without the old Tailwind config or tailwindcss-animate package. Active Radix primitives, Lucide, Zustand, Maps, Prisma, Firebase and optional Socket.IO behavior remain. Recharts remains in admin, which uses it; customer and rider removed it.

All three apps now use npm with their committed package-lock.json. The duplicate Bun lockfiles and unused Bun allowScripts metadata were removed. Dependency versions already retained in the npm lockfiles were not deliberately upgraded.

## Database and shared files

Versioned customer migrations and all three Prisma schemas remain. No database migration, reset or SQL patch was executed during cleanup.

The sync script now copies schema.prisma, db-data.ts and booking-events.ts to both sibling apps. It copies delivery-challenge.ts and ticket.ts only to rider, where they are used. Removing the unused admin copies therefore does not cause db:check to fail or db:sync to recreate them.

Customer setup documentation now points to the versioned migrations instead of the deleted manual SQL. The migration and deployment requirements are described in [database-rebuild.md](database-rebuild.md).

## Local outputs

The three .gitignore files now exclude tmp/ and output/. Those local files remain available; they are excluded from Git and deployment source. Final presentation files remain in Downloads/not related to fetch. The runtime loading animation remains in public/fetch-loading.gif.

Generated .next directories and node_modules were retained so the apps can continue running and building. Compiler caches and next-env.d.ts remain generated tooling files.

## Validation

- Separate TypeScript checks passed for customer, admin and rider.
- Production builds passed for all three apps after the dependencies were pruned.
- node scripts/sync-shared.cjs --check passed with the narrowed per-app helper list.
- All 22 selected existing customer/admin unit tests passed.
- Current public asset references and source imports were checked for removed targets.

Builds do not establish that every live workflow works. No database integration test or browser login/booking/proof workflow was performed as part of this file cleanup.

## Retained for a separate behavior decision

- Customer and rider GET /api stubs remain because external health checks may use them.
- Customer /api/auth/signup still supports rider registration and remains executable API behavior.
- Native rider tracking APIs, maintenance endpoints and demo seed routes remain.
- Admin tests/operations.integration.cjs was subsequently updated for AuthIdentity/SupportMessage and passed on 2026-10-07. It now runs in a fresh temporary schema and removes only its own schema. The cross-app database-rebuild integration test remains available in customer.
- Project documentation and animation authoring sources remain available locally. They were not removed merely because the runtime does not import them.
