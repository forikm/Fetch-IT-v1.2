# Customer mobile accessibility pass

Reviewed and fixed on 2026-10-31.

The later [mobile PWA redesign](customer-mobile-pwa.md) raises mobile app controls to 48px and replaces the workspace navigation; the measurements below record the earlier pass.

## Changes

- Primary mobile buttons, tabs, menu options, navigation icons, and saved-place removal controls use targets at least 44 CSS pixels high. Button labels can wrap and their default height grows with the content.
- Keyboard focus rings use the full ring color. Inputs use darker borders, and secondary text has stronger contrast on muted and delivery surfaces.
- History selects and cash/cancellation fields use 16-pixel mobile text. Passenger count requests a numeric keyboard; package weight and cash amounts request decimal input.
- Passenger and weight guidance is associated with the field using aria-describedby, and invalid values are exposed through aria-invalid.
- Saved-place naming has a visible label. Notification preference checkboxes have a larger clickable label.
- Rating stars have a darker selected color plus a live text status, such as “4 out of 5 stars selected,” alongside the existing pressed state.
- Focused fields have scroll margins beside fixed navigation, cancellation actions stack on narrow screens, and reduced-motion preferences suppress unnecessary movement.

## Verification

In the local production build at 360 x 800:

- Login, password visibility, sign-in help, dashboard buttons, and tabs measured at least 44 pixels in both dimensions.
- Profile menu items measured 44 pixels high.
- History search, status, and date fields retained their visible labels and measured 44 pixels high with 16-pixel text.
- Rating stars measured 44 x 44 pixels; selection updated the live text and pressed state.
- The checked login, history, and rating views had no horizontal overflow.

At 360 x 480, keyboard navigation reached the rating submit button within the visible viewport, and the form remained usable without horizontal scrolling. This is a shortened desktop viewport check, not a physical phone keyboard or assistive-technology certification.

Source-color checks found the previous secondary color (#627069) at 4.49:1 on the muted surface and 4.31:1 on the delivery surface. It is now #58675f. Rating selection changed from amber-500 to amber-700 in the light theme, with amber-400 retained for dark surfaces.

References: [W3C text contrast guidance](https://www.w3.org/WAI/WCAG22/Understanding/contrast-minimum.html), [target sizing](https://www.w3.org/WAI/WCAG22/Understanding/target-size-minimum.html), and [labels and instructions](https://www.w3.org/WAI/WCAG22/Understanding/labels-or-instructions.html).
