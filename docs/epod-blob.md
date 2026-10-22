# Private ePOD photo storage

New rider photo submissions use the private Vercel Blob store `fetch-epods`
(`store_b7H25SjJI8DnG8Ys`, Singapore). Neon stores a pathname in the existing
`DeliveryProof.photoUrl` column. No schema migration is required.

## Access

- Riders capture, preview and upload a photo for their own delivery in transit.
  Saved photo retrieval is denied in the rider app.
- Customer and rider booking responses exclude PHOTO proofs, including historical
  inline photos. Signature proof behavior remains unchanged.
- The admin booking detail page displays photos only after the existing
  `operations` permission check. Currently that grant belongs to Admin; unrelated
  Support, Finance and Safety roles do not gain blanket photo access.
- Superadmin uses its separate owner authentication to view photos in booking
  details. The photo API checks the current session on every request.
- Files are never public. Private photo responses use `private, no-store` and
  `nosniff`; callers cannot supply arbitrary Blob URLs or cross-booking paths.

## Vercel setup

The store has been created and initially connected to the known customer project
`fetch-it-v1-2` for provisioning. This connection does not display photos to
customers. The customer app does not need Blob credentials to serve its UI.

Deployment targets were recovered from the Fetch project chats and checked:

| App | Production URL | Vercel scope | Blob credential |
| --- | --- | --- | --- |
| Rider | https://fetch-it-rider.vercel.app | aldoususer | Production-only Secret saved and verified |
| Admin | https://fetch-it-admin.vercel.app | fita4 | Production-only Secret saved and verified |
| Superadmin | https://fetch-it-superadmin.vercel.app | aldoususer | Production-only Secret saved and verified |

These deployments share the SAME private store using `BLOB_READ_WRITE_TOKEN`.
Do not create a separate store per app. Production-only Secrets have been saved
and verified in all three projects under their owning accounts. Release the
customer filtering and staff viewers before enabling the rider upload. Keep
unrelated staff-portal/platform changes out of the Blob release commits.

On Vercel, connect a project from the store's Projects tab so the SDK can use
`BLOB_STORE_ID` and rotating Vercel OIDC authentication. For projects under another
account that cannot connect directly, set the store's `BLOB_READ_WRITE_TOKEN` as
a server-only encrypted environment variable. Never prefix credentials with
`NEXT_PUBLIC_`, commit them, or send them to the browser. The SDK's read-write
credential has broad storage access: access to individual photos is enforced by
the application routes.

Use appropriate environment scoping: preview/test apps must use isolated test
booking data and should not receive production photo credentials unnecessarily.
When changing stores, all apps reading a booking must resolve its saved paths
against the same store as its uploader. Redeploy after changing configuration.

Local ignored `.env.local` files in rider, admin and superadmin contain the shared
store configuration. The customer root's ignored `.env.blob.local` is used only
by the storage smoke check; Next.js does not load that custom file automatically.

## Upload and failure handling

The rider accepts JPEG, PNG or WebP source photos up to 12 MB, compresses them on
the device, and sends the existing JSON proof payload. The server bounds the
request to 820,000 bytes, verifies actual image bytes with Sharp, strips metadata,
normalizes orientation, and writes JPEGs no larger than 250 KiB. Images are at
most 1200 pixels on their longest side, with a smaller compression pass if needed.
A booking may contain at most three supporting photo proofs. Photos alone do
not complete delivery; recipient signatures still verify completion.

Assignment, payment and delivery state are checked before upload and again under
the booking row lock before saving the proof. Blob calls happen outside the
database transaction. A failed upload does not save or complete a proof. A file
is removed after a failed database write only when a follow-up lookup confirms
that its proof row does not exist. An uncertain commit keeps the file to avoid
destroying committed evidence and logs a non-sensitive reconciliation code.
Unexpected process termination or uncertain network responses can still leave
unreferenced files; reconcile those against proof records before deletion.

Existing inline JPEG/PNG/WebP proofs remain readable by authorized staff. They
are not automatically migrated or deleted. No retention/deletion policy for
saved delivery evidence is enabled by this integration.

## Verification and release

- `node --test tests/epod-blob.test.mjs`: image processing, storage failure,
  cancellation races, conservative cleanup, staff access, participant filtering,
  private responses and historical image compatibility.
- `node scripts/verify-epod-storage.cjs`: uploads a tiny disposable image, checks
  unauthenticated rejection and authenticated retrieval, then deletes it. This
  uses the real store and consumes a few operations.
- Type-check and build all four apps. Deploy the updated customer/rider filtering
  and staff viewers before enabling the new rider upload in production.

Hobby Blob has finite storage, operation and transfer allowances. Compression
reduces file size but does not remove operation limits. Monitor usage and decide
how long delivery evidence must be retained before enabling any cleanup policy.

References: [Private storage](https://vercel.com/docs/vercel-blob/private-storage),
[SDK setup](https://vercel.com/docs/vercel-blob/using-blob-sdk),
[usage limits](https://vercel.com/docs/vercel-blob/usage-and-pricing).
