# Member suggestions: payments, dispatch and admin access

All three apps use the shared customer-owned schema and helpers. Existing ratings remain available after completed bookings, with one review per booking.

## Before running the updated apps

1. From `fetch-customer`, run `npm run db:sync`, then `npm run db:deploy` against the intended environment. The new migration adds payment records and timed rider offers; it does not mark existing bookings paid. Existing bookings default to Cash / Unpaid because historical collections were not recorded.
2. Generate Prisma clients and build each app with `npm run build`. Release the apps together after the migration. Only the customer app deploys migrations.
3. In the admin environment, set `ADMIN_EMAIL_CODE_AUTH=true`, `GMAIL_SENDER`, `GMAIL_APP_PASSWORD`, and a strong `EMAIL_CODE_SECRET` (at least 32 characters). Use a Gmail app password. Admin codes have a distinct purpose from customer recovery codes and expire after 10 minutes, with five guesses and single use. Existing admin sessions are invalidated after password recovery.

## Payments

Cash is the currently supported payment method, explicitly shown when booking. No digital checkout or provider account is implied.

Customer and assigned rider record their paid/received amounts after acceptance. A booking becomes Paid only when both amounts equal its fare. One-sided or mismatched confirmations stay Pending. Confirmations cannot be silently edited; admins can resolve discrepancies with a required reason, or reset an erroneous confirmation to Unpaid. Every confirmation and correction has a payment history. Admin changes also appear in the audit log.

An admin can record Unpaid, Pending, Paid, Failed or Refunded. A refund can only follow Paid, and records that money has already been returned; it does not send money. Refunded records are final. Paid time and cash receipt reference are shown in the customer/rider payment card, admin fare record, customer receipt and admin CSV. Payment status is separate from booking status. Cancellation does not automatically refund a recorded payment.

## Dispatch

Admins can offer due bookings to an online rider with a matching vehicle and no other active booking. The rider has two minutes to accept. Rider reservations and acceptance are serialized to prevent double assignment. The rider job board refreshes online presence; riders whose presence has not refreshed for five minutes are excluded from new offers.

Declining or releasing a booking before pickup offers it to the next eligible rider, or returns it to the open job board when none is available. Previously declined/expired riders are excluded. Automatic offer chains stop after five riders; admins can deliberately offer again with a recorded reason. Once pickup or any payment confirmation occurs, reassignment is blocked until an admin resolves the situation. Customer cancellation requires a reason and confirmation.

Expired offers are processed by authenticated customer booking polls, rider feeds and admin booking detail views. For unattended operation, configure a scheduler to call `GET /api/dispatch/expire` on the **customer app**, every minute, with `Authorization: Bearer <CRON_SECRET>`. Set `CRON_SECRET` in that environment. This endpoint refuses calls when the secret is missing. No hosting scheduler or deployment was changed by this implementation; choose a schedule supported by your hosting plan.

## Verification

`node --test tests/*.test.mjs` runs local regression checks. `RUN_MEMBER_INTEGRATION=1 node tests/member-suggestions.integration.cjs` runs actual PostgreSQL transactions and route handlers in a randomly named disposable schema, with email mocked. It verifies payment races, mismatches/refunds, ownership, timed offers and reservation races, pickup/payment guards, cancellation reasons, password reset/replay, session revocation, login history and SMTP failures. It does not change application records or send email.
