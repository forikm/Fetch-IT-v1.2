# Rider applications

Implemented across the existing Customer, Rider, Staff and separate Superadmin projects. The Staff and Owner authentication systems are preserved; owner actions still require recent password confirmation.

## Applicant flow

1. Create a Rider account. New signups choose Motorcycle, Tricycle or Car.
2. Choose Delivery, Passenger rides or both. This records a request, not permission to work.
3. Verify the applicant email using a short-lived, single-use code.
4. Save personal, emergency, licence, vehicle, ownership and operating-area details.
5. Upload the checklist: profile photo, licence front/back, NBI, OR and CR. Borrowed vehicles require owner authorization and ID; pending transfers require a deed of sale. Tricycle/car passenger requests also require the applicable passenger permit and insurance. Additional medical/drug-test documents may be requested through review.
6. Submit. Details and uploads are locked during review.
7. If corrections are requested, replace only flagged items. Accepted items keep their decisions and earlier uploads remain in history.
8. Receive an orientation invitation with a personalized PDF, attend orientation and pass the recorded assessments.
9. An independent Admin or Owner activates each eligible service. Only activated, unexpired services can receive new jobs.

The initial checklist is in `src/lib/rider-application-policy.ts`. Review it against the actual operating area's requirements before accepting applicants. Document acceptance is a human review decision, not automatic verification with government systems. Commercial delivery vehicle classes remain available to existing riders; new applications currently cover the three agreed vehicle types.

## Staff and Owner

Open **Rider applications** in the Staff Portal or Owner Console. Admin, Safety and Owner may review; unrelated support/finance roles cannot open the documents. A Safety reviewer must claim the application and cannot open another reviewer's assigned application. Admin/Owner may oversee the queue.

Each details section and document has an Accepted / Needs correction decision; optional documents also allow Not applicable. Corrections require a specific explanation. Send one correction summary after reviewing the checklist. The rider sees exactly what to replace.

Recommend a complete checklist, then have a different Admin/Owner schedule orientation. Preview the email and PDF before sending. Record attendance and assessment after the scheduled start. Final activation requires an Admin/Owner different from both the recommending reviewer and the assessor. Delivery and Passenger rides are independent approvals; repeating an active approval is rejected.

Tricycle passenger activation requires a closed polygon of verified permit coordinates, entered as `[[longitude,latitude], ...]`. Both pickup and drop-off must be inside it. This is endpoint validation, not a claim that every road segment stays within the permit area. Do not invent an LGU permit boundary.

Reopening requires a reason and no active assignments. It revokes access, takes the rider offline, resets review decisions and clears the old orientation. Previous uploads, decisions and email history remain recorded.

## Privacy and email

Documents use the existing private Vercel Blob store under `rider-applications/`. Browser responses omit storage paths. Authenticated file reads check application ownership or reviewer access. Images are decoded, normalized and stripped of metadata. PDFs must be unencrypted, up to ten pages, and are served as downloads. Maximum document size is 3 MB.

No new sender account is required. Configure **the same existing Gmail account** using `GMAIL_SENDER` and `GMAIL_APP_PASSWORD` in Rider, Staff and Superadmin. Add the password directly through each project's secure Vercel settings; do not put it in source control or a chat. Preserve each app's existing session secrets, restricted database URL and private Blob token. Rider uses `SESSION_SECRET` to hash its verification codes.

Correction, orientation and activation messages have a persisted outbox and stable message identifier. `SENT` means the mail server accepted the message, not proof of inbox delivery. Configuration failures remain retryable. An SMTP disconnect may have occurred after delivery, so `UNCERTAIN` requires an explicit mailbox check before resending. Superseded messages and repeated active-service approvals cannot be sent again. Email verification and application writes are rate limited.

Direct Gmail sending is implemented. No cross-deployment email relay exists.

## Coordinated rollout

Production has the staff/owner platform and owner-password migrations already applied (read-only check on 24 October 2026). The new onboarding migration has **not** been applied by this task.

1. Configure and verify the existing Gmail sender in Rider, Staff and Superadmin. The connected Vercel account currently exposes only Customer, so the other projects need access through their owning accounts.
2. Take a current database-provider backup or branch using the maintenance account. The older application JSON backup script has an incomplete model list and must not be treated as a complete backup of the expanded system.
3. Review and apply `prisma/migrations/202610240001_rider_applications/migration.sql` through the canonical Customer migration workflow using the maintenance database credential (`npx prisma migrate deploy`). Never run migrations using app runtime credentials.
4. Keep the runtime groups restricted. The migration grants onboarding table access and limited RiderProfile/RiderPresence column updates to the Staff/Owner roles. The canonical `scripts/setup-runtime-roles.sql` also contains these grants for future role setup. Customer gets approval reads, not applicant-document writes.
5. Deploy the four coordinated app revisions. The schema is additive, but new dispatch approval checks require the migration first. Do not deploy the gated Rider signup without working verification email.
6. Verify production with a designated test applicant: verification email, private uploads, correction-only resubmission, staff/owner authorization, orientation email + real attachment, service-specific activation and job acceptance. No real applicants were approved and no real messages were sent during development checks.

Existing rider access is backfilled explicitly as `LEGACY_EXISTING`. This preserves prior service access and is displayed as legacy access, not as a document-verification badge. New signups receive no such approval. Expiry/revocation prevents new assignments; existing assigned jobs can still be completed.

## Validation

Final local result on 24 October 2026: all four production builds passed; all four TypeScript checks passed; focused lint checks passed; 107 focused regression/policy tests passed; the isolated onboarding database run passed 76 assertions, including runtime privilege checks. No production rows changed, real emails sent, or real Blob documents uploaded by those tests.

- Focused policy/upload/PDF tests: `node --test tests/rider-application.test.mjs`.
- Full database flow: set `RUN_RIDER_APPLICATION_INTEGRATION=1`, then run `node tests/rider-application.integration.cjs` from Customer. It migrates a fresh random schema, mocks Blob/SMTP, checks legacy backfill and the correction/orientation/activation flow, then removes only that schema. It does not alter production rows or send real messages.
- Shared-copy drift: `node scripts/sync-shared.cjs --check`.
- All four apps have passed production builds. Customer/Rider also require `npx tsc --noEmit` because their existing build configuration skips TypeScript build errors. Windows local verification used `npx next build --webpack` after a Turbopack CSS worker failure; package deployment scripts remain unchanged.
- Actual Rider, Staff and Owner browser screens were checked against the disposable fixture, including a narrow mobile viewport. The orientation PDF was rendered and visually inspected.

Local screenshots in Customer `output/` contain synthetic fixture data and are not production screenshots. Live Gmail delivery, Vercel production deployment and production migrations remain release steps.
