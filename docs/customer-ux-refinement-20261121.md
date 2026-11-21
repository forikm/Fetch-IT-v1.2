# Customer interface refinement

Customer UX and mobile PWA changes based on the live customer UI review. The release includes the booking toolbar, pickup and drop-off map footer, and interrupted-booking recovery.

## Release notes

- The release is based on `eb1a6b7`.
- The final PWA update passed 126 regression tests plus three customer install tests. Status recovery tests cover owner scoping, no writes, a lost response, an unchanged request key, and simulated checkout recovery.
- The UI refinement requires no database migration.

## Changes to include

- Keep one customer shell around lazy-loaded Home, Bookings and Profile content. Nested page wrappers reuse it so notification polling and navigation do not mount twice. Route loading also retains the customer destination; initial guest/session bootstrap keeps its existing loading screen.
- Use the customer shell on signed-in Support, including Back to Profile, Home, Bookings and notification booking navigation. Signed-out recovery remains available.
- Show a single booking action for empty lists. Hide history search/filters only when the unfiltered list is empty; active search/date/status filters remain visible when their results are empty.
- Group service selection, Active and History, booking, refresh, and update status in one compact toolbar. The controls measured at least 48 × 48 CSS pixels at a 320px viewport.
- Use transparent outlines for secondary actions, inset backgrounds for editable fields, and solid surfaces for cards. Keep distinct keyboard focus and invalid-field states.
- Shorten booking progress to Review, reduce header text, increase guidance to 14px, and explain why Next is disabled.
- Give map selection its own layout with a fixed pickup or drop-off confirmation button and a Search address action. Keep the selected address when leaving the map. Confirming still advances the wizard or saves an edit back to review.
- Keep shared ride/delivery surfaces, actions and navigation on the same palette. Retain local service accent tokens and service illustrations.
- Group profile preferences and shorten notification setup copy. Place one contextual install entry near the top of Profile. Use the browser prompt when available and offer manual iOS instructions in browser mode.
- Put active ride and delivery statuses above new-booking choices on Home. Customers can manage saved places from Profile and the address picker.
- Show account-scoped saved booking lists and timestamps while reconnecting. Limit the public app-shell fallback to 750ms on repeat navigations. Keep the offline reason beside the unavailable action.
- Let customers check an interrupted booking from Review. Use the same request key for the read-only status lookup and any explicit retry so a late response cannot create a second booking. Recover simulated checkout links when available.
- Keep the booking footer inside the available viewport and cap the height of the address suggestion list on short screens. The user will handle physical-device checks.
- Hide mark-all-as-read without unread items, state its bulk scope explicitly, and keep optimistic updates and failure recovery.
- Put the new-support-request form first when no conversations exist.

The existing booking status API now accepts an optional idempotency header for authenticated recovery. No database migration or changes to fares, simulated payments, ratings, pickup OTP/QR, delivery proof, or trip transitions are required.

## Verification

- TypeScript and targeted ESLint checks.
- Navigation, route fallback, notification optimism/rollback, history pagination, booking submission, rating and pickup/drop-off confirmation regressions.
- Production Next.js webpack build using a dummy local-only database URL.
- Browser layout checks with in-memory fixture responses at 320, 390, 768 and 1440px; no horizontal overflow in the inspected screens. Verified retained navigation during lazy loading, Support Back to Profile, history and notification empty states, light/dark profile styles and booking progress guidance.
- Live customer browser check reached the review screen using Google address suggestions, pickup map movement, pin confirmation, and a road-based quote of ₱50 for 2.37 km. The draft was restored to its initial empty state before closing the form.
- Local fixture review covered toolbar and form styles in light and dark mode. The temporary fixture was removed after the check.
- In the local ride wizard, live Google Maps and reverse geocoding confirmed both pins at 320 × 568. The fixed map buttons measured 48px high and stayed fully in view. Search address preserved the typed pickup, each new pin advanced the wizard, and confirming a pickup edit returned to Review. Booking and fare API responses were fixtures for this check.
- The local PWA preview verified that offline Home shows a saved timestamp and puts the active trip first. A lost booking response recovered to Booking details using the status lookup. The install entry measured 48px high and was visible above the first fold in simulated iOS browser mode. It was hidden in simulated standalone mode.
- The address step kept its footer in view at 390 × 360 with the address field focused. This desktop-browser check approximates the space available when a keyboard opens. Both themes passed 4.5:1 on the sampled map action, instructions, and booking error text.
- Isolated customer and rider API checks completed the cash ride and six simulated-payment journeys with PDF receipts. The ride checks covered the pickup code, customer pickup and drop-off confirmations, required rating, and history. The delivery proof check used a fixture image.
- The cash delivery passed through drop-off, payment confirmation, proof photo retrieval, required rating, and PDF receipt. Earlier attempts returned temporary 503 responses at rider acceptance and customer rating.
- A cash mismatch left payment pending and blocked both proof submission and receipt download as expected. The final cash-delivery suite passed both cases and removed its disposable database schema. Its report is in `output/journey/cash-delivery-report.json`.
- A different cash-delivery run logged Prisma `P1001` during the booking's existing-request lookup. The local journey test preserves the same request key for a single retry after a temporary booking error and checks for an existing rating before retrying it.
- Physical-device GPS, camera QR scanning, and a full live trip remain outside the browser coverage. Live browser verification stopped at fare review.
- The legacy rider-dashboard mock tests cannot mount the newer rider component because the mock lacks its alerts hook. The six customer tracking cases passed, including map marker updates and cleanup. The rider build passed 27 separate workspace, ride payment, and QR camera tests.

Preview captures are in `tmp/ux-review/`, including `toolbar-mobile-dark.jpg`, `live-fare-review.jpg`, `map-footer-mobile.jpg`, `pwa-home-offline-mobile.jpg`, and `booking-status-mobile.jpg`.
