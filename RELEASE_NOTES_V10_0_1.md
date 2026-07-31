# AgentRiskLayer v10.0.1 — Mobile navigation and usability polish

Status: locally validated candidate; production deployment and post-deployment device review required.

## Customer-visible corrections

- Corrected a legacy responsive selector that hid v10 navigation links on narrow screens.
- Rebuilt the mobile menu as a visible, scroll-contained panel beneath the sticky header.
- Added a dismissible backdrop, background scroll lock, Escape-to-close and focus containment.
- Kept menu labels synchronised between “Open menu” and “Close menu”.
- Closed the menu after navigation, viewport changes and page lifecycle transitions.
- Improved small-screen hero sizing, full-width calls to action and form font sizing.
- Added structured spacing to company facts and made the support email visibly tappable.
- Added safe wrapping for long support addresses and footer links.
- Aligned the end-to-end smoke assertion with the v10.0.1 application version so release validation checks the deployed version consistently.

## Preserved controls

No authentication, tenant isolation, assessment, billing, runtime policy, exact-action approval, inspection, red-team, remediation, evidence, database or production-service behaviour was removed or weakened.

## Evidence boundary

The correction is supported by source inspection, automated regression tests and local Chromium viewport checks. It is not independent accessibility certification or evidence that every physical device and assistive technology combination is defect-free.
