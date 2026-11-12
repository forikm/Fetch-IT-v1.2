# Ride and delivery pricing

Prices are in PHP. For the three bookable vehicle classes, use road distance,
round the combined transport fare to the nearest 5 pesos (ties round up), then
add the booking fee once. New quotes do not include time-based surge.

| Service | Included distance | Transport base | Additional km | Booking fee |
| --- | --- | --- | --- | --- |
| Motorcycle ride | 2 km | 40 | 10 | 5 |
| Tricycle ride | 3.5 km | 25 per passenger | 5 per passenger | 5 |
| Car ride | 2 km | 80 per vehicle | 15 | 10 |
| Motorcycle delivery | 2 km | 50 | 10 | 5 |
| Tricycle delivery | 2 km | 70 | 15 | 5 |
| Car delivery | 2 km | 100 | 20 | 10 |

Extra distance is proportional, rather than rounded up to a whole kilometre.
Motorcycle/tricycle/car delivery limits are 5/10/20 kg. Do not apply weight
surcharges within those limits. Existing passenger capacity limits still apply.

Ride rates and booking fees are defined in `src/lib/fare-policy.ts`. Delivery
rates remain configurable through the owner settings. The owner preview uses
the same quote functions as customer booking; zero cargo weight selects a ride.

The 3.5 km tricycle allowance is a proposed product rule, not a statement of
LGU approval or a definition of an official TODA boundary. Existing service-area
and rider route-approval checks continue to determine booking availability.

## Saved fares and accounting

`Booking.fareBreakdown` stores the server-signed, reviewed fare snapshot. The
nullable column is additive: historical bookings retain their stored totals and
legacy percentage-based online accounting. Checkout drafts preserve the same
snapshot when a booking is created after payment succeeds.

For new online bookings, rider earnings equal the saved transport fare and
Fetch-It's share equals the saved booking fee. Cash collection includes both;
the saved fee records the platform portion, but does not automatically remit
cash to Fetch-It. Online payment processing remains simulated.

Customer/rider payment views and PDF receipts read the saved snapshot rather
than recalculating using current rates. Valid quotes created immediately before
the release keep their reviewed amounts until their existing expiry.

## Release

Apply `202611120001_separate_fares` before releasing new Prisma clients. It adds
the optional snapshot and updates only delivery rate entries in PlatformConfig,
preserving availability, matching, and other settings. Synchronize the schema,
policy, accounting and receipt helpers across customer, rider and staff apps.

Focused checks cover all six fares at 2/3/5 km, proportional distance rounding,
passenger multiplication, fee reconciliation, signed quote integrity, historical
receipts/accounting, payment confirmation and booking retry behavior.
