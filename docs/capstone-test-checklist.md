# Fetch-It capstone test checklist

Use one customer account, one online rider with the matching vehicle class, and an admin account. Run the three apps against the same database. For a public demo, use accounts you created yourself; demo seeding is disabled in production unless `NEXT_PUBLIC_ENABLE_DEMO_SEED=true` is set on the customer and rider deployments.

## Customer booking

- Sign up, verify email, sign in, and sign out. Check an incorrect password and an unverified account.
- Deny browser location access. The form must ask for an address or map pin and must not insert a location automatically.
- Create an immediate delivery. Check that the fare appears before submission and the booking appears as pending afterward.
- Schedule a delivery for later. It must appear in customer history but not on the rider job board before its pickup time. A past pickup time must be rejected.
- Create a ride and confirm its vehicle options and fare. Try a vehicle or cargo weight that exceeds capacity.
- Cancel a pending request. Confirm it disappears from available jobs. Try cancelling after pickup; it must be rejected.

## Rider lifecycle

- Offline rider: the available job count and job board should be empty; accepting a job by API must fail.
- Online rider: only due jobs for the rider's vehicle class appear. Claim a job from two accounts at once; only one may succeed.
- Advance accepted → picked up → in transit → delivered. Try skipping a step, repeating a step, and completing a cancelled job; all must fail.
- For a delivery, submit a valid OTP or signature while in transit. Verify the booking completes once and the rider's completed count increases once, even after a repeated request. An invalid OTP must fail.
- Confirm rider fare labels refer to recorded fares, not wallet payouts.

## Admin and access

- A different customer must not be able to read or cancel another customer's booking or retrieve its OTP.
- A rider must not update a booking assigned to another rider.
- Admin can review bookings and cancel an active one, but cannot cancel a delivered one.
- Filter bookings and export CSV. Confirm exported rows follow the filters, open in a spreadsheet, and do not execute text beginning with `=`, `+`, `-`, or `@`.
- Confirm unauthenticated access to CSV export is rejected.

## Mobile and PWA

- At 320 px, 390 px, and 768 px widths, check login, delivery form, map, active booking card, rider board, and admin table. There should be no page-wide horizontal scroll on the customer PWA.
- Install the customer PWA, reopen it, and check navigation and sign-in. Repeat in normal browser mode.
