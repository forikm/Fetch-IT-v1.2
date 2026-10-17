# Customer notifications

Customers open the bell to choose **Deliveries**, **Rides**, or **Support**. Each tab and the bell show a red unread count. Selecting a tab does not mark its updates read. Selecting an update opens its booking or support conversation; “Mark as read” applies only to the selected category. New notifications and read status follow the account across devices. Older device-local booking notifications remain visible without duplicating matching server updates.

To receive background alerts, open **bell → Notification preferences → Enable background alerts**, then allow the browser permission. The existing profile notification settings provide the same control. On iPhone/iPad, use an installed Home Screen app on a supported OS. HTTPS is required outside localhost. The browser/OS must permit notification delivery; force-stopping the browser, focus modes, or operating-system restrictions can prevent or delay alerts.

## Server setup

Apply `npm run db:deploy` from fetch-customer before releasing the three apps. The existing shared database and `web-push` implement this feature; no paid service or new environment variables are required. The server generates one VAPID identity in `WebPushIdentity` on the first subscription setup. Its private key stays on the server and is never serialized by the APIs. Preserve this identity with database backups: rotating or losing it requires browsers to subscribe again.

Booking events and admin support replies create `CustomerNotification` records in the same transaction. The rider and admin apps share the notification helpers and Prisma schema through `npm run db:sync`. After a mutation commits and the HTTP response finishes, Next.js `after()` sends encrypted Web Push notifications. Delivery uses a leased database outbox to coordinate concurrent requests. Transient failures are queued for retry on subsequent booking/support mutations or inbox requests, up to five attempts; this does not create a dedicated scheduler or guarantee immediate retries during complete server inactivity. Expired subscriptions (404/410) are removed. Notification history remains available when push permission is denied or delivery fails.

Subscriptions require a signed-in customer and a valid HTTPS browser push-service endpoint. A device can belong to one account, with up to ten devices per account. Signing out revokes that device on the server; the service worker also persists the active account identifier locally to suppress alerts after offline logout or account switching. Support push messages contain a generic reply alert; the authenticated inbox contains the reply preview. Notification taps open the corresponding booking or support conversation, whose APIs enforce ownership.

## Verification

- `node --test tests/customer-push.test.mjs tests/notification-inbox.test.mjs`: subscription validation, legacy deduplication, category counts/read actions, red badges, closed-page service-worker handling, deep links, and logout/account isolation.
- `$env:RUN_PUSH_INTEGRATION='1'; node tests/customer-push.integration.cjs`: fresh disposable PostgreSQL schema; actual rider and admin route handlers; transactional outbox, concurrency, read state, ownership, retry/expiry, and subscription lifecycle. Transport is captured rather than sent; the real Web Push SDK still signs and encrypts each captured request.
- `$env:RUN_DATABASE_INTEGRATION='1'; node tests/database-rebuild.integration.cjs`: all three production servers against a disposable schema, covering booking claims, ride OTP, signatures, tracking, support, account restrictions, and persistent rate limits.
- Real device acceptance check: sign in, enable alerts, close the customer tab, accept/update a booking from the rider app or reply from admin, then tap the OS alert. Verify its destination and category badge. This step requires permission on that device; automated transport tests do not prove OS delivery.
