# Mobile recovery improvements

Customer photo proof has independent thumbnail and full-view loading states, a reserved image frame, retry controls and a five-second slow-loading message. Cached images that load before hydration are recognized without waiting for a second load event. Images remain uncropped and private photo URLs use the existing authenticated route.

Booking, fare and notification requests show immediate activity and additional feedback after five seconds. Booking requests time out after 30 seconds while retaining their existing idempotency key and saved draft. An uncertain response offers Check Active bookings before another explicit attempt. Notification updates retain optimistic feedback and use a bounded request; failures restore the previous display.

New bookings open a saved summary with Track booking. Empty history distinguishes first use from no filter matches and provides a relevant booking or Clear filters action. Offline empty screens describe missing saved content rather than claiming that no bookings exist. Location permission guidance appears beside the affected booking step, and the trip map offers Retry my location after a GPS failure.

## Verification

- TypeScript and targeted ESLint checks.
- `node --test tests/mobile-recovery-ui.test.cjs tests/completed-delivery-ui.test.cjs tests/customer-epod-photo.test.cjs tests/required-ride-rating.test.cjs tests/booking-rating-prompt.test.cjs`
- Browser fixture verified a failed photo followed by a successful retry, full photo preview, cached-image hydration, and Clear filters leading to the first-use history state. Phone-width content had no horizontal overflow.
- Temporary fixture routes were removed after verification.

No new paid service or dependency is introduced. Real-phone GPS and permission prompts were not exercised during this pass.
