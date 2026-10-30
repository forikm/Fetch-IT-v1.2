# Customer journey checks

The integration runner exercises the customer and rider production builds over real HTTP against a unique disposable PostgreSQL schema. It does not create bookings in the normal application schema.

## Run

Build both apps first using their installed Next CLI. Set the rider checkout and an environment file containing the database URL:

~~~powershell
$env:RUN_JOURNEY_INTEGRATION = '1'
$env:JOURNEY_ENV_FILE = 'C:\path\to\customer\.env'
$env:JOURNEY_RIDER_ROOT = 'C:\path\to\fetch-rider'
node tests/customer-journey.integration.cjs
~~~

The optional BOOKING_TEST_DATABASE_URL overrides the database URL. The runner uses localhost ports 3230 and 3231; JOURNEY_CUSTOMER_PORT and JOURNEY_RIDER_PORT override them.

The runner migrates a random schema prefixed with fetch_journey_test_, pins trigger function search paths to that schema, and starts both servers with generated session secrets. Child servers receive no SMTP, Blob, push, or Firebase credentials. Fixture sessions work only on those local test servers. The runner stops its servers and drops its own schema in a finally block.

## Coverage

Nine scenarios:

- Ride and delivery, each with simulated GCash, Maya, bank, and cash payments.
- A cash delivery with mismatched customer and rider amounts, which must remain pending and block completion and a receipt.

The checks cover fare calculation, booking creation, simulated checkout ownership, acceptance, pickup progress, pickup OTP, ride and delivery completion, matching cash confirmations, owner-only proof photos and receipts, one rating per booking, rider rating aggregates, and completed history.

Photo records are seeded with a synthetic inline image. Live Blob uploads are outside this test. Generated receipts and the result report go to ignored output/journey/.

## Browser verification (2026-10-30)

Desktop browser viewports of 390 x 844 and 360 x 800 were used with local fixture bookings:

- Accepted ride opens driver details, pickup progress and code, and safety controls.
- Dial 911 has tel:911 as its destination; no call was placed.
- Cancellation offers “My driver asked me to cancel” and can be dismissed.
- Completion automatically asks for a rating. Submission requires a star selection and shows saved feedback.
- Delivery history opens proof, payment confirmation, and a full photo with its original aspect ratio.
- Failed photo requests display Retry photo, and retry restores the image.
- Cash and long-address PDF receipt samples were rendered and visually inspected.

The live Help recovery link incorrectly showed ordinary sign-in during client navigation. It now uses a document navigation so the recovery query initializes a fresh auth screen.

These checks do not establish physical Android/iOS dialer behavior, soft-keyboard behavior, live GPS or map rendering, or live photo uploads. The credential-free local map displays its failure and retry state. Staffed recovery contact details are still awaiting the owner's supplied contact.

## Waiting for acceptance

Customer ride and delivery cards, summaries, and tracking views distinguish waiting, an offer awaiting acceptance, and future scheduled pickup. After three minutes without acceptance, the message becomes “No driver/rider has accepted yet.” This is a presentation threshold, not a timeout or a claim about the entire driver pool. Scheduled requests measure waiting only after pickup is due.

Check for an update reads the authenticated status endpoint for the same booking. It never submits a replacement booking. Cancellation remains explicit and requires the existing confirmation and reason. Paused updates show the last known status. Older responses cannot replace newer acceptance or cancellation timestamps, and open summaries receive live status patches.

Run the focused checks with:

~~~powershell
node --test tests/booking-wait.test.mjs tests/booking-wait-ui.test.cjs tests/customer-booking-ui.test.mjs
~~~
