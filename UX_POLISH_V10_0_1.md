# AgentRiskLayer v10.0.1 — Mobile and usability correction evidence

Status: implementation candidate. Production deployment and physical-device retest are required before recording the deployment decision.

## Observed production defect

The owner’s Android screenshots of the v10 homepage showed that the mobile menu button changed from the hamburger icon to an X, but the navigation links were not visible. The same review identified a support label and email address without sufficient visual separation.

## Root cause

Two legacy responsive selectors from earlier page generations still applied to the v10 header:

- a narrow-screen rule hid ordinary `nav` links;
- a broader header rule hid non-button links below the tablet breakpoint.

The v10 menu container opened correctly, but those older selectors continued hiding its child links.

## Implemented correction

- Scoped both legacy selectors away from `.site-header-v10`.
- Rebuilt the v10 mobile menu as a visible panel below the sticky header.
- Added a dismissible backdrop, body scroll lock and scroll containment.
- Added synchronised accessible open/close labels.
- Preserved Escape-to-close and added focus containment.
- Marked the closed mobile navigation `aria-hidden` and `inert`.
- Closed the menu after link selection, viewport changes, hash navigation and page lifecycle transitions.
- Improved narrow-screen hero sizing, full-width primary actions and 16-pixel form controls.
- Added structured spacing to company facts and converted the support address to a tappable email link.
- Added safe wrapping for long contact addresses.

## Verification performed in the build environment

- Static experience-design tests passed: 6/6 after the correction.
- JavaScript syntax checks passed for the shared shell and configuration.
- Headless Chromium interaction checks confirmed all seven public navigation links were visible at 360 pixels, the first link received focus, Escape closed the menu, focus returned to the menu button, and the support fact used a six-pixel label/value gap.
- Representative static pages were checked at 360, 768 and 1440 pixels: homepage, company, pricing, help, dashboard, control plane, assessment and trust. No document-level horizontal overflow was observed in those checks.

## Evidence boundary

The browser checks loaded the exact HTML, CSS and shell JavaScript in an in-memory Chromium page because direct localhost navigation is blocked in this environment. They do not replace post-deployment testing on the owner’s Android phone, desktop browsers, keyboard-only navigation or representative screen readers.

No authentication, tenant isolation, billing, assessment, runtime policy, exact-action approval, inspection, red-team, remediation, evidence, database or production-service behaviour was removed or weakened by this correction.

## Release validation correction

- Aligned the end-to-end smoke assertion with the v10.0.1 application version so release validation checks the deployed version consistently.
