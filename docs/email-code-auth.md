# Customer email codes

Firebase remains the customer login and password store. With `NEXT_PUBLIC_EMAIL_CODE_AUTH=true`, Fetch-It sends six-digit verification and password-reset codes through its own Gmail sender. The customer never opens a Firebase verification/reset link. After checking a code, the server sets Firebase's `emailVerified` flag or changes the Firebase password through the Admin SDK. Existing database PASSWORD accounts can also reset their passwords through this form.

These operations update the existing identity and user; they do not create replacement accounts, change IDs, or move bookings. Rider and admin login are unaffected. The minimum new password remains six characters.

## Gmail setup

1. Create a dedicated regular Gmail account using **For my personal use**. A paid Google Workspace account is unnecessary for this capstone setup. Keep the account's recovery access with the project owner.
2. Enable Google **2-Step Verification**, then create an **App Password** named Fetch-It. Use that App Password for SMTP, never the normal Gmail login password. [Google's instructions](https://support.google.com/accounts/answer/185833) explain the requirements and cases where App Passwords are unavailable. If it is unavailable, stop here and select another sender method rather than paying for an upgrade.
3. Configure the following only in the **customer** project's Vercel environment variables and local `.env` when local email testing is wanted. Enter raw values without quotation marks in Vercel. Keep all current Firebase settings and `SESSION_SECRET`.

| Name | Value |
| --- | --- |
| `GMAIL_SENDER` | `fetchitsupport@gmail.com` |
| `GMAIL_APP_PASSWORD` | Its App Password; spaces are stripped by the server |
| `EMAIL_CODE_SECRET` | A separate random secret of at least 32 characters |
| `NEXT_PUBLIC_EMAIL_CODE_AUTH` | `true` when all sender settings are ready |

The ignored `local-email-code-setup.json` contains a generated code secret. Add the Gmail address and App Password directly to your private environment settings. Do not share the passwords or generated secret in chat, screenshots, or Git. Only the boolean feature flag is public; SMTP credentials and the code secret stay server-side.

4. Apply the additive database migration from fetch-customer with `npm run db:deploy`, then redeploy the customer app. The public flag is compiled into the browser bundle, so changing it requires a new deployment. With the flag absent/false, the existing Firebase link flow remains available. Do not enable the code screens before the sender is configured.

## Limits and failure behavior

- Codes last ten minutes, allow five guesses and work only once. A replacement invalidates the previous code. Row locks prevent concurrent confirmations from using a code twice.
- Codes are cryptographically random. Neon stores HMAC hashes, purpose and identity bindings; plaintext codes are not returned to the browser or logged.
- Verification sending and confirmation require a Firebase ID token for the same identity. A reset code is separate from a verification code. Disabled/banned accounts and rider/admin identities cannot use customer reset.
- Sending has a one-minute cooldown and six requests per hour per email/purpose, plus 30 send requests per hour per IP. Checking is limited to 120 requests per hour per IP. Both purposes share a conservative budget of 200 send requests per fixed 24-hour window; unsuccessful and unknown-account requests count too. Responses use HTTP 429 and `Retry-After` when throttled.
- Reset requests always give a generic response for unknown or ineligible email addresses. SMTP failures also keep reset responses generic; verification displays a delivery error. No email-code endpoint logs recipient addresses, code values or passwords.
- Resetting invalidates existing customer cookies and Firebase refresh tokens. Profile edits preserve the original authentication time instead of refreshing it. A Firebase sign-in in the exact second of a reset may need to be repeated after a second because Firebase authentication timestamps have second precision.
- If the provider fails after a code is consumed, request a new code. A used code is never made reusable. Email delivery, including inbox placement, needs a real mailbox check after configuration.

Gmail has [sending limits](https://support.google.com/mail/answer/22839), including a nominal 500-email daily threshold and possible temporary blocks. This is suitable for a small capstone demonstration, not a promise to serve 1,000 daily signups. Resends and password resets use the same allowance. Never send to the synthetic defense accounts. No paid service was added; normal Vercel/Neon usage still counts against existing quotas.

The encrypted application backups exclude temporary email-code rows and request-limit buckets. Expired/consumed codes cannot be used even if their rows remain in the database; each email/purpose has only one row. The reset-invalidating timestamp on User is included in application backups.

## Checks

```powershell
node --test tests/auth-*.test.mjs tests/customer-signup*.test.mjs tests/offline-session.test.mjs tests/security-helpers.test.mjs
$env:RUN_AUTH_EMAIL_INTEGRATION='1'
node tests/auth-email-code.integration.cjs
npx tsc --noEmit
npm run build
```

The integration test migrates and removes a new isolated Neon schema. Its Firebase and SMTP adapters are fake: it never changes real credentials or sends real emails. It checks hash storage, expiry, five-attempt lockout, concurrent consumption, resend replacement, identity/purpose binding, account privacy, both password stores, preserved booking ownership, session invalidation, and sender failure.

On October 8, 2026, the additive migration was applied after an encrypted backup. The restore drill verified all 914 users and 21 bookings in a temporary schema and removed that schema. Authentication regressions (42 checks), the isolated email-code integration test, TypeScript, lint and the customer production build passed. The selected sender is fetchitsupport@gmail.com. The code flow is enabled in deployments built with the four configured Gmail/code settings; real delivery still requires an owned-mailbox check after deployment.

After configuring the sender, use only an owned mailbox: create one customer, enter its code and confirm login. Check a wrong code and resend once; the older code must fail. Reset its password with a new code, verify the old password/cookie fails, then sign in with the new password. Confirm the same account and bookings remain visible. Also check an owned older database account. Do not run quota/load tests against real mailboxes.
