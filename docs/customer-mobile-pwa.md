# Customer mobile PWA redesign

Updated 2026-10-31.

## Navigation and screen hierarchy

- Home shows both service choices together, opens the selected booking form directly, and provides compact active-booking links across both services.
- Bookings contains Active and History, with a separate Ride/Delivery service selector. Its selected tab survives visiting Home or Profile.
- Profile is a screen with explicit editing, appearance, saved places, installation, notifications, help and confirmed logout. Opening Profile does not focus an input.
- Main customer screens share one app header and selected navigation. Marketing menus, duplicate greetings, map previews and branded footers were removed from this workspace.
- Browser/phone Back closes booking overlays before leaving their screen, including nested driver, cancellation, rating/help and proof-photo dialogs. Reloading clears stale overlay metadata.

## Touch, layout and feedback

- Shared mobile buttons, fields, tabs, menus, close buttons and rating stars use 48px minimum targets. Map zoom has custom 48px controls; Google attribution remains intact.
- The booking wizard uses a full-screen phone layout with a fixed action area, scrollable step content and an optional pin picker. Address search comes first. Empty saved-place sections are hidden.
- Ride tracking puts pickup progress, driver identity/plate and the road map before expandable trip/payment details. Call driver and Dial 911 remain in a sticky action area.
- Refresh keeps a loaded booking list visible. Changing service/history queries clears the previous query's list before loading, so errors never present another query's results.
- The global connection banner stays visible and reserves space above the header and full-screen overlays. Saved booking timestamps and paused tracking messages remain.
- Viewport zoom is enabled. Safe-area spacing, wrapping controls, reduced motion and visible focus are retained.
- Appearance supports device preference, light and dark. Browser theme color follows the current surface.
- PWA Ride/Delivery/Track shortcuts open their intended destination after authentication/onboarding. Existing shortcut source parameters remain supported.

## Behavior preserved

Customer ownership checks, booking expiry, idempotent submission, service-area validation, cash confirmation, simulated online checkout, PDF receipt gating, ePOD photo authorization/retry, rating submission and emergency dialer links retain their existing rules. New Home completion observations also prompt for ratings.

## Verification

Relevant automated regression commands cover navigation and nested Back, offline data/session/worker behavior, map loading and road geometry, booking confirmation/retries, simulated payments, cash confirmation, customer ePOD photos, ratings and pickup progress. Customer-only test selections avoid requiring a sibling rider checkout; the shared pickup test can use PICKUP_RIDER_ROOT.

Production build: next build --webpack. Type checking runs separately before the build. ESLint covers the changed source and tests.

Visual verification uses local mock booking data in the production build, not real bookings or payments. Phone-size checks do not certify an operating system's keyboard, installed-PWA behavior or assistive technology.

Final checks passed: 103 relevant automated tests, ESLint, an independent TypeScript check, and the webpack production build. Browser checks covered 390x844, 360x640 and 360x480 phone layouts, plus 1024x768 desktop navigation. Both Home service actions and checked app controls met 48px targets, with no horizontal overflow. The slow-response fixture retained its booking card while showing Updating. Reconnection reserved 56px above the header and adjusted the booking dialog accordingly. Delivery shortcut and map confirmation advanced to the correct form step; Track opened Active bookings.
