# Customer ride confirmations

Ride customers now confirm two separate milestones:

1. The driver verifies the existing pickup OTP/QR. The customer then selects
   **I'm on board** and confirms pickup. Only then can the driver start the trip.
2. During the trip, the customer selects **I've arrived at drop-off** and
   confirms arrival. Only then can the driver complete the ride, subject to the
   existing payment checks.

These are customer acknowledgements, separate from payment and pickup-code
verification. They do not independently prove GPS arrival. Delivery workflows
are unchanged.

## Persistence and enforcement

The owning customer submits `POST /api/bookings/[id]/ride-confirmation` with
`{ "action": "PICKUP" }` or `{ "action": "DROPOFF" }`. The server chooses the
timestamp and actor. It locks the booking, checks ownership and ride stage, and
atomically saves the acknowledgement and its audit event. Retries return the
original acknowledgement without adding another event.

The nullable `customerPickupConfirmedAt` and `customerDropoffConfirmedAt` fields
are included in booking detail and status updates. Saved acknowledgements survive
closing the tab, restarting the browser, or reopening the ride. Failed writes are
reconciled with a fresh read; the client never automatically resubmits them.

The rider API enforces both gates, so bypassing disabled buttons cannot advance
the ride. Pickup verification, passenger confirmation, trip status and payment
remain separate checks. Existing active rides already in transit can acknowledge
pickup before confirming drop-off. Completed historical rides are not rewritten.

## Local validation and release

Local checks cover ownership, wrong actors, invalid actions and ride stages,
concurrent taps, idempotent retries, audit rollback, saved-state recovery,
offline behavior, confirmation dialogs, status gates and payment regression.

The shared schema and migration are prepared in all four apps. Before deploying,
apply `202611180001_customer_ride_confirmations`. Update the staff apps' generated
clients before new audit event values are written, then release the customer
controls and rider enforcement together. Do not release the enforcement without
the customer controls.

Release order is database migration, staff clients, customer controls, and then
rider enforcement. Verify each deployment before proceeding to the next stage.
The temporary browser fixture under `tmp/confirmation-qa` uses synthetic
in-memory data and is excluded from the release.
