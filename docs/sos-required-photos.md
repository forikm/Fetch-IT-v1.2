# SOS and required delivery photos

Changes are on codex/sos-required-photos-20261101 in each app's tmp/automatch-release worktree, based on the pushed automatic-matching release. The original working folders with unrelated changes were preserved.

Passenger SOS is available after driver acceptance until ride completion. Tapping SOS obtains a fresh device GPS fix and creates an URGENT support request linked to the passenger and booking. The record contains coordinates, accuracy, capture time and the server creation time. Open SOS retries reuse the same ticket. Ownership, active ride status, input freshness, same-origin access and rate limits are checked on the server. GPS denial and transport failures show explicit feedback; the existing phone dialer action remains available. SOS does not confirm a staff response.

Admin and Superadmin notifications prioritize SOS requests. Support detail shows an urgent banner and a link to the recorded location. Staff use the existing claim, conversation and resolve flow. Staff notifications use the existing authenticated polling mechanism; this change does not introduce an external emergency-service connection or staff background push.

Delivery completion requires a recipient signature AND a saved photo, including through direct status-update requests. Previously uploaded photos count. New photo upload failures cannot complete a delivery. Existing completed deliveries are not changed. Saved images remain private to authorized staff.

No database migration or new secret is required. Deploy Admin/Superadmin first, then Rider, then Customer. These changes have not been pushed or deployed by this task.

Validation: TypeScript checks across all four apps; 22 SOS/photo/storage tests in Customer and 26 Rider photo/matching/workspace tests. Customer cross-app tests use FETCH_SIBLING_ROOT=C:/Users/Z/Downloads and FETCH_SIBLING_WORKTREE=tmp/automatch-release. Customer and Rider production builds also pass. Database-dependent end-to-end and real-device GPS tests have not been run.
