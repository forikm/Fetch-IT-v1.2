# Staff notification routing

The shared Neon schema owns durable routing. Source changes and staff notices
commit in the same transaction through database triggers. The apps deploy
independently; this additive migration must precede their coordinated rollout.

## Views and permissions

- **My alerts:** the current recipient's assignments, customer replies, handoff
  updates, supporting-note reminders, and personal account security.
- **Team intake:** unassigned CS requests, Supervisor/Safety reviews, eligible
  independent Admin decisions, application reviews, and cash discrepancies.
- **Operations:** role-targeted announcements and sanitized service advisories.
- **Platform alerts:** Superadmin-only shared-service incidents and verified
  platform-wide reports. Ordinary bookings and customer messages do not enter it.

Current record ownership and role permissions are checked again on every feed
read and read-receipt write. Old notices cannot retain access after reassignment.
Each view displays the latest event per record, with separate security events.
Read receipts are persisted per account, not in browser localStorage.

Opening a team-intake notification uses the existing **Claim & start review /
View only / Cancel** component. No GET, preview, link prefetch, or read receipt
takes ownership. A case update does not resolve its customer conversation or
perform a payment/account intervention. CS handoff priorities remain manual.

## Emergencies

The existing passenger emergency endpoint sets an explicit `isEmergency` signal.
Its transaction creates a linked Safety case and durable Safety intake notice.
Normal support messages are never classified by keyword. Legacy open, explicit
urgent-alert records are backfilled without copying all historic notifications.

Taking ownership or assigning an eligible reviewer stamps `acknowledgedAt`.
Reading or marking an alert read does not acknowledge it. A still-unacknowledged
case becomes an urgent Admin backup item after 60 seconds at the next monitor
sweep. The alert banner is independent of read state. Safety polls while visible
every five seconds, other staff every fifteen; polling is not a background
emergency delivery guarantee and does not contact emergency services.

**Production scheduler:** `.github/workflows/notification-monitor.yml` runs
`scripts/monitor-notifications.cjs` on a standard GitHub-hosted runner about every
five minutes, plus manual dispatch. The public repository uses free Actions
runners. GitHub schedules are best effort and can be delayed; a closed-dashboard
backup may therefore arrive five minutes or more after its 60-second threshold.
This is not an instant emergency-delivery service or a guaranteed response time.
The portals also sweep when checking their inboxes.

The workflow calls `GET /api/maintenance/notifications` with a dedicated
`NOTIFICATION_MONITOR_SECRET`, stored as an encrypted repository secret and a
sensitive Vercel Production variable. The existing receipts cron keeps its
separate `CRON_SECRET`. Installations without the dedicated secret retain the
legacy fallback. Neither credential is exposed to the browser or job logs.

Enable the repository variable `NOTIFICATION_MONITOR_ENABLED=true` only after
deploying the endpoint and configuring both copies of the new secret. Set it to
`false` to pause the scheduler. Run **Actions > Notification monitor > Run
workflow** to verify a deployment; the job fails on HTTP errors, timeouts, or an
invalid JSON result. Check Actions for failures and disabled schedules: GitHub
can disable public-repository scheduled workflows after 60 days of inactivity.
A supervised worker may instead use `--watch` for minute checks.

## Operational signals

- Road-routing and booking endpoints record post-response request/failure counts
  by service and minute, without user IDs, addresses, or request payloads.
- Validation/authentication/rate-limit 4xx responses are excluded.
- A shared-service incident requires at least 20 requests, 10 server failures,
  at least 50% failures, and failures in two minute buckets in a five-minute
  window. Recovery needs at least ten successful requests, no failures in that
  window, and at least five minutes since the incident's last transition.
- Regional backlog uses coarse 0.05-degree pickup grids. Ten eligible unassigned
  requests waiting over five minutes create an advisory. Future scheduled,
  expired, unpaid simulated-online, and already assigned requests are excluded.
- Five explicit passenger emergency signals in the same coarse pickup grid within ten minutes create a Safety-volume incident. This signals investigation, not a confirmed common cause. Only an authorized recovery decision clears this incident.
- Obsolete notifications are pruned after 90 days in bounded batches; active case/incident work and the original audit history are retained.
- Incidents emit one opening/reopening event and one recovery event per revision.
  Monitoring repeats do not repeatedly notify the same active condition.
- Superadmin can publish a verified regulatory, safety-pattern, infrastructure,
  or supply incident, and record recovery with recent identity verification and
  an audit reason. Only the staff-safe headline/scope/instructions are shared.

A complete database/app outage cannot report itself through the failed app or
database. External uptime monitoring and a staffed out-of-band emergency channel
remain necessary. This feature does not claim to detect fraud, weather, merchant
payouts, collision telemetry, or courier emergencies that Fetch does not collect.

## Rollout and verification

1. Keep a recovery point and deploy the additive migration from the canonical
   customer app using the maintenance connection. Do not use `db push` or reset.
2. Retain restricted runtime credentials. The migration grants the new table and
   function permissions to the existing runtime groups. Source triggers insert
   notices; customer/rider runtimes cannot read the staff inbox. Staff cannot
   manufacture notices, modify incidents, or read Superadmin-only notices.
3. Deploy the synchronized schema/helpers and Customer, Staff, Superadmin, and
   Rider source changes together. Runtime-role setup also preserves new grants.
4. Configure and verify the GitHub scheduler and external uptime/emergency operations.
5. Verify fresh request, claim/view-only/cancel, reassignment, replies, both CS
   handoffs, independent decisions, passenger emergency/backup/acknowledgment,
   application routing, cash-review completion, announcements, and security.

`tests/staff-notifications.integration.cjs` runs only against a disposable schema
in the dedicated Fetch test database. It rejects production hosts/schemas. The
QA runner owns its synthetic data and its schema cleanup.
