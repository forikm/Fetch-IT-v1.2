# Customer support

Customers can open `/help` from the navigation or Contact Us section. The page
includes FAQs, booking and account requests, and full conversations. Booking
cards retain **Get help**, using the same conversation interface scoped to that
booking. A support notification links directly to `/help?ticket=<id>`.

## Guided requests

The request form starts with **What’s the issue?** and offers **Issue with
Delivery**, **Issue with the Ride**, **Account or app help**, and **Something
else**. Delivery and ride each reveal **Issue with the rider**, payment and
cancellation help, plus service-specific choices such as missing packages or
items left behind. The customer then links a matching booking and receives a
writing prompt for the selected concern. A booking’s **Get help** dialog keeps
that booking linked and shows its service’s issue choices.

The form preserves unsent descriptions when changing choices and when a send
fails. It displays the description limit, explains where replies appear, and
confirms a successful send in the conversation. Account and general questions
do not require a booking. FAQs use the same button and option labels as the form.

The API validates the topic/issue combination and booking service, derives the
existing staff category, and prefixes the initial message with both selected
labels. Staff can read the full context using the existing inbox; older clients
and tickets remain supported. No database migration is required for guided
requests. The complete message, including the issue labels, stays within 2,000
characters.

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

The integration check starts the production customer app on port 3210 and the
development admin app on port 3212, and applies migrations to a fresh random PostgreSQL
schema. It tests ownership, roles, duplicates, general requests, priorities,
two-way replies, reopening, optimistic conflicts, the unanswered queue, read
receipts, and pagination. It removes only its own temporary schema and servers
on completion. It does not deploy the migration to the application schema.
The staff fixture includes a live staff session. The admin app runs in development
because production requires restricted database credentials, while the test uses
the schema owner only inside its disposable schema.

`tests/support-ux.browser.mjs` checks the browser interactions with isolated API
fixtures: issue choices, matching and older bookings, drafts, failed sends,
reopening, empty/error states, and desktop/mobile widths. Start a local customer
build on port 3215 and run the script with Playwright available. Use
`SUPPORT_UX_URL` for another preview URL, `SUPPORT_PLAYWRIGHT_MODULE` for a bundled
Playwright module URL, and `SUPPORT_BROWSER_CHANNEL` to override the default
installed Edge browser. Screenshots are saved in the ignored `output/` folder.

Use `SUPPORT_TEST_DATABASE_URL` to choose a dedicated test database; otherwise
the configured database hosts the isolated schema. All test connections explicitly
use that schema for raw SQL and triggers. For browser review, additionally set
`SUPPORT_PREVIEW=1`; run it in an interactive terminal. After checks pass the preview
remains open with test-only logins until a newline is sent, stdin closes, or ten
minutes elapse. Never use those accounts in production.
