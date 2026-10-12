# Fetch-It bug audit — 12 October 2026

Reviewed the customer, rider and admin apps, focusing on booking, tracking,
payments, pickup OTP, delivery proof, account access and support.

## Confirmed issues fixed

| Issue | Before | After |
| --- | --- | --- |
| Ride GPS missing from the customer map | Ride tracking rendered only pickup/drop-off pins and discarded incoming GPS. | The live map receives the booking's latest GPS and clears it on reassignment. |
| Stale rider Active jobs | Only Available jobs polled; cancellation/reassignment on another screen left the open job and buttons visible. | Active jobs and statistics refresh every 10 seconds while visible/online. Open details refresh or close when the job leaves the active list. Aborted and older responses cannot overwrite newer results. |
| Rider logout and account races | A network failure prevented logout from clearing the screen; delayed account checks could restore a logged-out rider. | Logout clears local state immediately. A device flag requests cookie revocation before reading an account on reconnect/reopening. Session generations reject stale responses, and expired/restricted sessions leave the dashboard. |
| Install controls retaining a consumed browser prompt | Each control kept its own copy of the one-use prompt. Other controls could still offer an already-consumed prompt; initialization also failed the React lint check. | Controls subscribe to one browser snapshot, all clear on consumption/installation, and duplicate prompt calls are blocked. |

Ride tracking also reads current booking status directly, so reassignment does
not retain boarding controls or a previous driver's revealed code.

## Test maintenance

- Updated the admin query-normalization test for the existing payment-status
  filter. Production filtering was already correct.
- Updated support fixtures for current session issue times and the existing
  restriction behavior: a banned account's cookie is invalidated before access,
  returning 401. The support service was already enforcing this correctly.

## Verification

- 113 customer/shared unit and regression tests and 6 admin tests passed.
- TypeScript checks passed in all three apps; customer/rider source lint passed.
- All three production builds passed. TypeScript was checked separately because
  the existing build configuration skips TypeScript validation.
- Disposable-schema integrations passed for booking/security, native GPS,
  ride OTP, delivery signature/photo proof, cash confirmation, reassignment,
  online test checkout, refunds/payouts, email-code authentication, password
  resets, support conversations, notifications, pagination and admin pages.
- Browser check: the customer map exposed the live driver marker; the passenger
  revealed the OTP and the driver boarded successfully. An admin then cancelled
  the disposable ride through the real API. The rider's open dialog closed and
  Active jobs became empty; customer tracking showed Cancelled. Database checks
  confirmed one boarding event and one cancellation event.
- All test schemas, local test servers and browser tabs were removed.

## Limits

This audit covers the inspected paths and tested scenarios, not a guarantee of
zero remaining bugs. Online checkout remains simulated; no real money was
charged. Native GPS requests were tested, but background tracking on a physical
Android handset and real wallet/bank processing were not verified here.
