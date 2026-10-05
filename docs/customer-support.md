# Customer support

Customers can open `/help` from the navigation or Contact Us section. The page
includes FAQs, booking and account requests, and full conversations. Booking
cards retain **Get help**, using the same conversation interface scoped to that
booking. A support notification links directly to `/help?ticket=<id>`.

Customers can send follow-ups and reopen resolved requests. Replies stay in the
same ticket. Messages and requests are paginated, drafts survive navigation in
the current browser tab, and errors keep unsent text available for retry.

The admin support inbox shows both customer and admin messages, general account
requests, assignment, priority, and status. The unanswered queue and overview
count include customer follow-ups. Active booking requests start at high priority;
admins can adjust this. Resolving requires an answer to the latest customer
message. Stale admin forms return a conflict rather than overwrite newer activity.

## Notifications

The existing customer notification bell includes support replies, fetched from
the server every 30 seconds while the app is visible and online, and when opened.
Open conversations refresh every 10 seconds. Support read status is saved in the
database and follows the customer account across devices. Reading a specific
reply does not mark later replies as read or invalidate an admin's draft.

The existing admin bell includes new requests and customer follow-ups. It polls
every 30 seconds and links to the conversation. Admin notification read status
continues to be saved per admin on the current device.

These are in-app notifications; this release does not send email, SMS, or
background web-push alerts. Keep an admin signed in during staffed hours.

## Configure contact channels

Optional customer app environment variables:

```dotenv
NEXT_PUBLIC_SUPPORT_EMAIL=
NEXT_PUBLIC_SUPPORT_PHONE=
NEXT_PUBLIC_SUPPORT_HOURS=
```

Set real staffed contact details in the deployment environment and rebuild the
customer app. Leave a channel blank to hide it. Email and telephone links appear
on Help and Contact Us, including for customers who cannot sign in. Hours are
operator-supplied text; this release does not check whether the phone is currently
staffed. No contact address, number, response-time promise, or 24/7 claim is invented.

## Coordinated rollout

The customer app owns the shared schema and migrations. The new additive migration
`202610050001_support_conversations` retains existing tickets and replies, marks
existing messages as admin-authored, allows a nullable booking, and backfills
conversation timestamps. It also updates the ownership trigger for account requests.

1. From `fetch-customer`, run `npm run db:check` and `npm run db:deploy` against the
   intended shared database. Do not reset the database.
2. Deploy the customer and admin builds together. The rider schema copy is updated
   for consistent client generation; its UI has no support changes.
3. Set the real contact variables and staff the admin inbox.
4. Check a booking request, an account request, both directions of replies,
   notifications, and reopening a resolved request.

Old customer builds only show a single admin reply and do not support customer
follow-ups; old admin builds cannot handle account requests without a booking.
Complete the coordinated update before inviting customers to the new support flow.

## Verification

```powershell
node --test tests/*.test.mjs
npx tsc --noEmit
npm run build
$env:RUN_SUPPORT_INTEGRATION='1'
node tests/support.integration.cjs
```

Build the admin app first as well. The integration check starts both production
apps on ports 3210 and 3212 and applies migrations to a fresh random PostgreSQL
schema. It tests ownership, roles, duplicates, general requests, priorities,
two-way replies, reopening, optimistic conflicts, the unanswered queue, read
receipts, and pagination. It removes only its own temporary schema and servers
on completion. It does not deploy the migration to the application schema.

Use `SUPPORT_TEST_DATABASE_URL` to choose a dedicated test database; otherwise
the configured database hosts the isolated schema. All test connections explicitly
use that schema for raw SQL and triggers. For browser review, additionally set
`SUPPORT_PREVIEW=1`; run it in an interactive terminal. After checks pass the preview
remains open with test-only logins until a newline is sent, stdin closes, or ten
minutes elapse. Never use those accounts in production.
