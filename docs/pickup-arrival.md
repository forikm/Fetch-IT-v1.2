# Pickup arrival progress

The rider's accepted ride now includes **I’m heading to pickup** and **I’ve arrived at pickup**. Customer ride details poll the owner's pickup-progress endpoint and distinguish acceptance, heading, and driver-reported arrival. These are explicit driver reports; GPS alone never marks a driver as arrived. Pickup arrival estimates use fresh, assignment-scoped GPS and the existing distance/vehicle-speed model. They are approximate, exclude traffic and waiting time, and disappear for stale, unavailable, pre-assignment, or mismatched driver fixes. They are distinct from estimated trip duration.

Progress is stored as immutable STATUS_CHANGED booking events with ACCEPTED as both the old and new booking status. Reserved reasons identify heading and arrival. No schema migration or booking-status enum change is required. A current assignment's matchedAt (or creation time for historical records without matchedAt) excludes earlier reports, including reassignment to the same driver.

The rider endpoint validates the current rider account, locks the booking, checks current assignment and accepted ride status, and rejects regression after arrival. Retries are idempotent. The event, updatedAt, and customer notification commit in one transaction. Customers can only read their own booking's stage and report time, without event actor data.

Ship the rider endpoint and controls together with the customer read endpoint and panel. Older clients can continue their existing pickup-code flow. Driver reports do not replace identity checks or pickup-code verification.

Payment details show each participant's cash confirmation. Delivery proof includes payment, receipt, rating, and help actions. Online payments remain simulated.

Verification from the customer checkout:

    $env:PICKUP_RIDER_ROOT='path-to-rider-checkout'
    node --test tests/pickup-progress.test.cjs tests/pickup-progress-ui.test.cjs tests/auth-view.test.mjs tests/customer-payment-card.test.mjs

The two pickup-progress modules must stay identical. No database migration is needed.
