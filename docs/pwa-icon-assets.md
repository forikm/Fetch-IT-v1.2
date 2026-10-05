# Customer PWA icon assets

The regular icons preserve the original transparent PNG bytes. Android maskable icons use a separate opaque cream canvas, with the artwork inside the central safe circle. See [web.dev's maskable icon guidance](https://web.dev/articles/maskable-icon).

Assets referenced by the manifest:

- `public/pwa-icon-any-v2-192.png`
- `public/pwa-icon-any-v2-512.png`
- `public/pwa-icon-maskable-v2-192.png`
- `public/pwa-icon-maskable-v2-512.png`

The maskable master was edited with the built-in imagegen tool from `public/fetch-icon-final-512.png`, then resized with Sharp. The original website logo and standard icon artwork remain unchanged. The generated rendition keeps the orange tile, white F and rocket, but is not a pixel-identical copy of the source.

Generation mode: image edit, `transparent_background: false`.

Final prompt:

> Use case: compositing. Asset type: Android PWA maskable icon, square PNG. Input image is the exact existing Fetch-It brand icon to preserve. Create a platform-safe rendition only: keep the orange rounded square, white F, rocket, colors, outlines and shadows exactly as supplied; do not redesign or restyle any part. Center the existing artwork on a perfectly uniform flat opaque background of hex #fff7ed. The visible orange tile must occupy only 54 percent of the full square canvas width and height, centered precisely, to keep all artwork within the Android circular safe area. The entire canvas, including all corners and margins, must be fully opaque #fff7ed. No black surround, no extra frame, no gradient, no texture, no additional lettering, no new shadow outside the existing artwork. Produce one square icon.

`tests/pwa-icons.test.mjs` checks dimensions, separate icon purposes, standard icon transparency and byte preservation, opaque light corners, and maskable artwork bounds. Native Android launch rendering still needs a device check. Installed PWAs can retain their old launcher icon; reinstalling after deployment can force a refresh if it persists.
