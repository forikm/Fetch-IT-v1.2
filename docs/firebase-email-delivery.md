# Verification email delivery

The customer app uses Firebase's default email service. Firebase accepting a send request does not guarantee placement in a recipient's inbox. The app offers resend and tells customers to check spam, while preserving the verification screen when they leave for their email app.

## Current configuration

On October 5, 2026, the verification sender display name was set to **Fetch-It** and confirmed by reading Firebase's configuration back. Firebase rejected a subject change with `EMAIL_TEMPLATE_UPDATE_NOT_ALLOWED`; the subject remains `Verify your email for %APP_NAME%`. Verification links and the default delivery service remain unchanged. `%APP_NAME%` is Firebase's project display name, as described in the [email template reference](https://docs.cloud.google.com/identity-platform/docs/reference/rest/v2/Config#EmailTemplate).

A sender display name helps recipients recognize the message. It does not change the sending domain, its reputation, or guarantee inbox placement. Without the affected message's full headers and the recipient provider's diagnostics, the exact reason for a spam decision cannot be determined.

## Improve delivery after obtaining a domain

1. In Firebase Console, open **Authentication → Templates → Email address verification → Customize domain** and enter a domain you own.
2. Add the exact DNS records Firebase provides. Merge SPF senders into the domain's existing SPF record rather than adding a second SPF record. Set up DKIM and an aligned DMARC policy for the sending domain using the provider's guidance.
3. Wait for domain verification, then select **Apply Custom Domain**. Use a recognizable Fetch-It sender address and working reply-to address owned by the project.
4. Send an explicitly requested test verification email and inspect SPF, DKIM and DMARC results in its headers. Check delivery with the email providers customers use; authentication improves delivery but cannot force inbox placement.

Firebase's [custom email domain guide](https://firebase.google.com/docs/auth/email-custom-domain) explains the domain setup. Google's [sender guidelines](https://support.google.com/mail/answer/81126) explain authentication, reputation and spam placement. If greater control over templates or delivery is needed later, Firebase can generate [verification links for a custom mail service](https://firebase.google.com/docs/auth/admin/email-action-links); a provider and authenticated sender domain must be configured first.

## Regression checks

Run `node --test tests/auth-*.test.mjs tests/offline-session.test.mjs tests/customer-signup*.test.mjs` to check progress expiry, clearing on sign-in/logout, preservation after unauthenticated session checks, resuming verification with the saved phone number, and Firebase signup recovery. Tests use fake accounts and a local REST fixture; they do not send real emails.
