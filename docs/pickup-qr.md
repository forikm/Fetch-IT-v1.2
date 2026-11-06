# Ride pickup QR

The customer opens their accepted ride and selects **Show pickup code**. The existing owner-only OTP endpoint returns the same six-digit code and expiry as before. The screen renders a black-and-white QR locally alongside the digits. No QR service, image upload, new API, or database migration is needed.

At pickup, the assigned rider selects **Scan pickup QR** and permits camera access. Scanning checks the QR format, booking ID, and displayed expiry, then fills the manual OTP field. The rider still selects **Verify pickup code**. The existing server endpoint remains responsible for assignment, status, actual code validity, attempt limits, expiry, and one-time use. QR metadata is never trusted as proof of verification.

Camera frames stay on the device. The decoder loads only when scanning starts and runs at most four times a second with frames reduced to a maximum dimension of 640 pixels. Scanning stops after a matching QR, on manual stop, when details unmount, when actions become unavailable, or when the app becomes hidden. Camera denial and unsupported devices leave manual entry available. If the QR display cannot load, the passenger can still share the digits.

Local automated checks (set `FETCH_RIDER_ROOT` for a non-sibling Rider checkout):

```powershell
$env:FETCH_RIDER_ROOT = 'C:/path/to/fetch-rider'
node --test tests/pickup-qr.test.mjs tests/pickup-otp-upgrade.test.mjs tests/delivery-challenge.test.mjs
```

In Rider:

```powershell
node --test tests/pickup-qr-camera.test.cjs
```

On two real phones over HTTPS, confirm rear-camera permission, scan readability in both themes, manual entry after denial, wrong-booking and expired QR feedback, successful server verification, and camera shutdown after leaving the booking. Scanning alone must never mark the passenger as on board. Delivery signatures and signup verification are unaffected.
