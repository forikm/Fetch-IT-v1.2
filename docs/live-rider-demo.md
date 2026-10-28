# Live Rider application demo

Rider signup offers **Use demo · Account** and an explicit **Register for demo** checkbox. A visitor enters their own email and password and verifies the emailed code. Demo mode never supplies a real person's address, shares a password, returns a verification code, or bypasses authentication.

Each remaining registration step offers **Use demo**. The server generates matching fictional adult/vehicle details from the Lingayen–Binmaley–Dagupan corridor and clearly marked sample portraits/PDFs. Files use the normal private upload and read endpoints. Normal version locking, rate limits, correction rules, independent review and assessment rules remain active. Only the applicant's own verified, editable demo application can use the generator.

Admin and Superadmin display **For demo**, offer an application-type filter, and include a labeled demo count in the application pipeline. Changes refresh while the page is visible. Existing synthetic applicants are marked from their audited `DEMO_SEEDED` event, not inferred from names.

Production uses the existing Gmail sender and private Vercel Blob configuration. Verification emails go to the account address. Correction, orientation and completion emails go to that same verified applicant and carry **[DEMO]** in the subject and a demonstration notice in the body. Orientation messages attach a marked PDF and explicitly describe a demonstration appointment. Local lab runs continue to capture mail and store files privately on disk; their staff shortcuts and automatic verification remain unavailable in production.

Demo applications can reach **DEMO_COMPLETED** after the existing review and assessment steps. Completing a demo creates no rider service approval, updates no working vehicle profile and grants no booking access. The real activation endpoint rejects demo applications server-side.

**Start real application** keeps the account and verified email but archives every current demo upload, clears the review/orientation/assessment state, and restores any real draft details saved before the demo (or starts a new draft). No sample upload or accepted demo review carries into real approval. Existing working riders cannot switch their account to a demo. History remains private for review and auditing.

The additive migration `202610280001_rider_application_demo` introduces `RiderApplication.isDemo` (default false) and marks the five previously audited synthetic examples. Deploy the compatible Admin/Superadmin review code before enabling the new Rider signup and generation controls. Customer retains synchronized schema/helpers; its booking UI does not change.

Validation: existing onboarding regression suite extended with draft-preservation assertions against a disposable PostgreSQL schema with SMTP/Blob simulation; dedicated production-mode endpoint/asset/email tests; TypeScript checks across all apps; production bundle includes all five sample portraits; PDF render review; live deployment smoke checks. Actual production mail is sent only through the normal authenticated verification and review actions.
