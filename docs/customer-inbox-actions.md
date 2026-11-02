# Customer inbox and history

“Mark as read” updates the local inbox immediately. An account-scoped save runs
in the background; failures restore the affected state and show an error. Polls
pause while saving and responses started before a mutation cannot replace it.
The save needs no follow-up inbox reload. One inbox GET includes legacy replies.

“Dismiss notification” hides an individual alert and marks it read. The source
row remains so retries and legacy support fallbacks cannot recreate the alert.
Bookings, receipts, delivery proof, support tickets and messages are retained.
The inbox keeps its existing limit of the latest 100 events per category.

History requests return 10 bookings plus a cursor. “Load older bookings” appends
the next page. Filters and customer ownership apply to every page. No booking
retention or deletion policy is introduced.

## Rollout

Apply `prisma migrate deploy` with the migration owner connection before deploying
the new customer app. Migration `202611020001_notification_dismissal` adds one
nullable column and preserves existing rows. Older app deployments can continue
using the shared database. The shared-schema sync includes the migration.

## Validation

Run the notification, inbox API, history pagination and customer push unit tests.
For PostgreSQL validation, set `RUN_INBOX_INTEGRATION=1` and optionally
`INBOX_TEST_ENV_FILE` / `INBOX_TEST_DATABASE_URL`, then run
`node tests/customer-inbox.integration.cjs`. It creates a unique test schema,
verifies migration/read/dismiss/ownership/cutoff behavior, then removes that schema.
