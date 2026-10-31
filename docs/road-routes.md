# Customer road routes

The customer booking preview and ride/delivery tracking maps draw the road geometry returned by Google Maps Routes Library. The request uses DRIVING and asks only for path and warnings.

The orange line follows the returned road path. Pickup/drop-off pins, the rider marker, and the customer's local-position marker remain separate. Moving live markers does not recalculate the pickup-to-drop-off route. Simultaneous requests for the same endpoints share one pending request; completed geometry is not cached outside the mounted maps.

A failed or timed-out route request leaves the map and pins visible and offers Retry road route. The map does not substitute a straight line. Closing a map or switching bookings detaches the old route and ignores late responses. The viewport includes road bends as well as the markers.

## Google Cloud configuration

Use the existing NEXT_PUBLIC_GOOGLE_MAPS_API_KEY. Enable the Maps JavaScript API and Routes API for its Google Cloud project, with the existing billing account and appropriate website/API restrictions. Existing address search also requires its Places service. No server-side secret is introduced.

Google setup: https://developers.google.com/maps/documentation/javascript/routes/start
Route request and geometry: https://developers.google.com/maps/documentation/javascript/routes/get-a-route

The route is a driving-route display. This change does not replace the existing fare or estimated-duration calculation.

## Verification

Run:

~~~powershell
node --test tests/road-route.test.cjs tests/google-maps-recovery.test.cjs
~~~

The tests cover actual returned bends, no-route and malformed results, concurrent requests, retries, deadlines, late responses, map cleanup, and independence from live GPS updates.

A real Google Routes request was also verified in the local production build on 2026-10-31 using the existing Maps configuration and fixture endpoints in Lingayen. The preview and tracking map both showed the returned road bends; no routing errors were reported.
