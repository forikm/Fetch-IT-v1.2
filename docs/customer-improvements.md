> The manual SQL instructions below describe the previous schema. For the rebuilt database use versioned migrations and [database-rebuild.md](database-rebuild.md).

# Customer improvements

## Customer experience

- Delivery and Ride cards show progress from request to completion, with a distinct cancelled state.
- Status polling refreshes every 15 seconds and on reconnect/focus. Changes show an in-app alert. Profile settings offer optional browser alerts while the app is open; this is not background web push.
- Profile settings update the customer's name and phone in the shared database. Email and account role cannot be changed through this endpoint.
- History supports server-side reference/address search, completed/cancelled filters, date ranges, and pagination in batches of 100.
- Download receipt saves a text booking receipt. It includes the quoted fare and does not claim that cash payment was collected.
- Customers can review their own completed booking once. Ratings update the rider's average atomically, including simultaneous submissions.
- Booking help saves customer requests in the shared database. Duplicate open requests for the same category are rejected without clearing the customer's draft message.
- Admins review tickets and recent rider feedback at `/dashboard/support`, reply, and mark tickets open, in progress, or resolved. Customers read replies by reopening Booking help or tapping Refresh replies.
- Mobile dashboards include Home, Bookings, and Profile navigation with safe-area spacing.

## Shared database

The schema is synchronized across Customer, Rider, and Admin. Apply the additive, repeatable SQL to a database before deploying these features there:

```powershell
npx prisma db execute --file prisma/add-customer-features.sql --schema prisma/schema.prisma
npx prisma generate
```

The SQL only creates `CustomerReview`, `SupportTicket`, and their indexes. Existing booking/user columns are unchanged.

## Notification inbox and compact history

The bell in the customer hub and both dashboards opens a booking notification inbox. Status updates are saved per account on this device, with an unread badge and a mark-all-read action. Selecting an update marks it read and opens the matching delivery or ride summary. Initial sign-in establishes a baseline without flooding the inbox with old bookings; subsequent status changes are checked every 15 seconds and when the tab regains focus or reconnects.

History rows show only the completion/cancellation status and destination address. Selecting a row opens the full summary, including route, fare, rider, progress, receipt, rating, help, and repeat-booking actions. The ride booking form is hidden in mobile history and reappears when repeating a ride.

Dialogs fit the viewport width and height with internal scrolling. The delivery form wraps long addresses, uses a short vehicle label, and keeps its Back and Confirm controls reachable on narrow phones.

## Verification

```powershell
node --experimental-strip-types --test tests/customer-request.test.mjs
node --experimental-strip-types --test tests/booking-notifications.test.mjs
npx tsc --noEmit
```

For API integration checks, run Customer on port 3000 and Admin on port 3002, with their `.env` files pointing to the same database. Node 24 is required by this test script. It creates disposable users and completed bookings only, then removes its own fixtures:

```powershell
$env:RUN_CUSTOMER_INTEGRATION='1'
node tests/customer-features.integration.cjs
```

Checks cover authentication, ownership, profile validation, duplicate ratings, concurrent rider averages, filtered/paginated history, receipts, duplicate support requests, and admin replies. No real rider dispatch or payment is performed.
