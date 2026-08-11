# Website v2 implementation

## Purpose
Website v2 separates the public marketing experience from the authenticated security workspace while preserving one AgentRiskLayer brand and evidence model.

- Public: bright editorial layout, custom security/evidence visuals, restrained motion and stronger product storytelling.
- App: dark operational workspace with calmer hierarchy and unchanged workflow semantics.

## Files
- `public/website-v2.css` — shared visual system for public and app surfaces.
- `public/website-v2.js` — local progressive motion: reveal, authority demo, evidence chain and product tour.
- `public/visuals/*.svg` — local illustrations with no remote resources or scripts.
- `public/index.html` — Website v2 homepage storyboard.
- `public/site-shell.js` — loads Website v2 and normalises public navigation.

The previous `premium-theme.css` and `premium-media.css` remain in the repository for rollback/history but are no longer loaded by `site-shell.js`.

## Security/trust boundaries
This release must not change authentication, authorisation, tenant isolation, assessment/evidence/finding/remediation/retest semantics, approval integrity, deployment decision logic, billing, Stripe, email, PostgreSQL or runtime policy enforcement.

Marketing visuals are illustrative unless they explicitly render current product data. Declared controls must not be styled as verified controls. Remediation must not be styled as closure until exact retest evidence supports closure.

## Motion/accessibility
Motion uses CSS transforms/opacity and small vanilla-JS observers. `prefers-reduced-motion: reduce` disables loops and reveals content immediately. Hidden controls remain `display:none!important` and focus visibility is preserved.

## Rollback
The visual release is isolated from data migrations. Reverting the Website v2 merge restores the previous presentation without reverting customer records or database state.
