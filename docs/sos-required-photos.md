# Urgent safety alerts and required delivery photos

Changes are on codex/sos-required-photos-20261101 in each app's tmp/automatch-release worktree, based on the pushed automatic-matching release. The original working folders with unrelated changes were preserved.

The customer-facing feature is labeled "Urgent safety alert to Fetch-It staff". It saves a request for staff review; staff response is not guaranteed and it does not dispatch emergency services. The separate Dial 911 action remains directly accessible.

Passenger safety alerts are available after driver acceptance until ride completion. Tapping the safety-alert button obtains a fresh device GPS fix and creates an URGENT support request linked to the passenger and booking. The record contains coordinates, accuracy, capture time and the server creation time. Open safety-alert retries reuse the same ticket. Ownership, active ride status, input freshness, same-origin access and rate limits are checked on the server. GPS denial and transport failures show explicit feedback; the existing phone dialer action remains available. The interface explicitly explains the response limitation before and after sending.

Admin and Superadmin notifications prioritize safety-alert requests. Support detail shows an urgent banner and a link to the recorded location. Staff use the existing claim, conversation and resolve flow. Staff notifications use the existing authenticated polling mechanism; this change does not introduce an external emergency-service connection or staff background push.

Delivery completion requires a recipient signature AND a saved photo, including through direct status-update requests. Previously uploaded photos count. New photo upload failures cannot complete a delivery. Existing completed deliveries are not changed. Saved images remain private to authorized staff.

No database migration or new secret is required. Deploy Admin/Superadmin first, then Rider, then Customer. Production releases use the existing GitHub main-branch Vercel deployments. Verify each Vercel commit status and the live endpoints after publication.

Validation: TypeScript checks across all four apps; 22 safety-alert/photo/storage tests in Customer and 26 Rider photo/matching/workspace tests. Customer cross-app tests use FETCH_SIBLING_ROOT=C:/Users/Z/Downloads and FETCH_SIBLING_WORKTREE=tmp/automatch-release. Customer and Rider production builds also pass. Database-dependent end-to-end and real-device GPS tests have not been run.

New records use URGENT SAFETY ALERT. Existing SOS EMERGENCY ALERT records still receive urgent display, notification priority and retry deduplication. Internal API/component names are retained for compatibility.
