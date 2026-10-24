# Presentation demo activity

Batch `demo_activity_20261024_v1` uses 50 existing customers selected evenly from the verified 900-account synthetic manifest. It does not change their names, email addresses, credentials or original records.

Created on 24 October 2026:

- 200 historical bookings: 100 rides and 100 deliveries; 163 completed and 37 cancelled.
- 110 explicitly labeled demo reviews.
- 3 offline, non-login demo couriers for the historical assignments.
- 5 fictional rider applicants: Mateo Dizon, Liza Soriano, Renato Villanueva, Ana Mercado and Joel Bautista. Their names start with `Demo` and their email addresses end in `.invalid`.
- 5 profile photos labeled **DEMO**, stored privately with the applications.
- 29 clearly invalid test PDFs for document checklist slots; these are placeholders, not imitations of government credentials.

The application examples cover Submitted, In review, Needs correction, Recommended and Orientation scheduled. These are demonstration states, not real verification decisions. The accounts have no authentication identity, online presence, verified email or service approval. The orientation example is explicitly not a real appointment; no invitation was queued.

All inserted booking references start with `DEMO-`, all finish in a terminal state, and notes/events/reviews identify the batch. Quoted fares use the existing pricing engine and configured pricing. Payment status remains unpaid, with no collection, commission, transfer or payout recorded. Booking events are inserted directly so the live notification helper is not called. The transaction checks notification, application-email and service-approval counts remain unchanged.

Dates are spread across the available history of those existing customers, up to 30 days, with activity today. No booking predates its customer's account. Staff's Today / 7 days / 30 days filters and Superadmin's 14-day trend therefore use the normal database queries. Both dashboards disclose included demo bookings and show the application pipeline.

## Reproducibility

The reviewed plan is in `scripts/demo-activity-plan.cjs`; the runner is `scripts/seed-demo-activity.cjs`. The runner requires the existing ignored `local-defense-users.json` manifest and the final DEMO-only photo assets in `output/demo-activity-20261024/photos/demo-only/`. This is intentional: it must not silently choose real customer accounts or invent new recipients.

Read-only plan:

```powershell
node scripts/seed-demo-activity.cjs
```

Create and visually inspect the test PDF placeholders before the first apply, using the PDF artifact workflow:

```powershell
node scripts/seed-demo-activity.cjs --prepare-documents
```

Explicitly apply the batch:

```powershell
$env:ALLOW_DEMO_ACTIVITY_SEED = '1'
node scripts/seed-demo-activity.cjs --apply
```

The runner creates and verifies an encrypted snapshot of every existing application table before uploads and insertion. Database inserts are atomic and protected by a batch lock. Rerunning a complete batch reports `alreadySeeded` and does not duplicate bookings, overwrite reviewer decisions, or upload another set of documents. Partial or conflicting batches fail for inspection. Private uploaded files are removed after a failure only when a follow-up database lookup confirms they are unused.

The ignored `local-demo-activity-20261024.json` manifest tracks inserted IDs and private document paths for later, explicitly authorized cleanup. The original generated portraits, final edited portraits, prompt set and document previews are kept under the ignored output folder; only the final DEMO-only portraits are used by applications.

Validation: `node --test tests/demo-activity.test.cjs`; Staff and Superadmin production builds and TypeScript checks. No schema migration is required for this batch.
