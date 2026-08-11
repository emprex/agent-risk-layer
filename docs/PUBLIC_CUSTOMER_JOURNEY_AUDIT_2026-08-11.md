# Public customer journey audit — 2026-08-11

## Assessed production state

- Public origin: `https://agentrisklayer.com`
- Repository: `emprex/agent-risk-layer`
- Production code assessed before repair: `5ff3206d4ca1ba600eb86abca876fbe953615ee1`
- Product version reported by `/api/health`: `10.1.1`
- Product stage reported by production: `production`
- Audit method: read-only Chromium journey against public production plus repository inspection
- Production audit workflow run: `31500568693`
- Focused defect verification run: `31501512270`
- Final repair validation run: `31503731849`

This audit is not a penetration test and does not prove private authenticated customer journeys, tenant isolation, payment completion, webhook delivery, transactional email delivery, or authenticated remediation/retest behaviour.

## Public journey observed

The following public pages returned HTTP 200 in desktop and mobile Chromium checks: homepage, demo, pricing, assessment, authentication, trust, help, sample report, security centre, company and quickstart.

The audit observed no same-origin HTTP error responses or console errors on those sampled pages. Production `/api/health`, `/api/ready` and `/api/config` returned HTTP 200 during the audit. Pricing exposed through the production configuration matched the approved catalogue for the paid assessment and Developer, Team and Agency subscriptions.

## Proven defects

### 1. Assessment controls marked `hidden` were visibly rendered

**Impact:** workflow clarity and correctness. The Step 1 assessment screen exposed controls that should only appear later or in revision mode, including `Back`, `Show my result` and `Review all previous answers`.

**Root cause:** component CSS set explicit `display` values on `.button` and `.field`, overriding the browser's user-agent `[hidden]` rule. Diagnostic Chromium evidence showed the affected elements retained `hidden=true` while computing to `display:flex` or `display:grid` with non-zero geometry.

**Repair:** the assessment shell now explicitly preserves the HTML hidden contract with `.assessment-shell [hidden] { display: none !important; }`.

**Retest:** final Chromium validation confirmed all three affected controls retain the hidden property, compute to `display:none`, and have zero visible geometry before the workflow exposes them.

### 2. Demo page overflowed narrow mobile viewports

**Impact:** visual usability. At a 390px viewport the document widened to 410px and the hero heading was cut off horizontally.

**Root cause:** after the hero grid collapsed to one column, the unbroken `AgentRiskLayer` token in a 50px heading still exceeded the available content width. The grid also retained an automatic minimum track.

**Repair:** the mobile hero uses `minmax(0, 1fr)`, children may shrink to the track, and the heading uses a bounded responsive size that keeps the product name inside narrow phone widths.

**Retest:** Chromium validation passed with no document-level horizontal overflow at both 390px and 360px.

### 3. Trust limitations section overflowed narrow mobile viewports

**Impact:** visual usability and trust-page readability. At a 390px viewport the document widened to 395px.

**Root cause:** the limitations grid's automatic minimum and the 46px heading containing the unbroken product name widened the section beyond the viewport.

**Repair:** the limitations grid now collapses through `minmax(0, 1fr)`, children can shrink, and the mobile heading size is bounded responsively.

**Retest:** Chromium validation passed with no document-level horizontal overflow at both 390px and 360px. The data-boundary table retains its intentional contained horizontal scrolling and does not widen the document.

## Validation evidence for the repair branch

Final validation workflow run `31503731849` passed:

- `npm ci`: 0 product dependency vulnerabilities reported before the disposable browser verifier was installed.
- `npm run check`: passed.
- Focused customer-journey tests: 3/3 passed.
- Full regression suite: 272 tests, 271 passed, 0 failed, 1 skipped. The skipped PostgreSQL research-migration test requires its separate database environment and was not exercised by this UI-only change.
- Chromium verification: assessment hidden-state contract passed; demo and trust document widths passed at 390px and 360px.

A temporary Playwright package was installed only inside the disposable validation runner and was not added to AgentRiskLayer's package manifest or lockfile.

## Observed follow-up, not repaired in this change

The Help Centre still describes an older assessment evidence vocabulary (`Owner statement`, `documented`, `tested`) while the current assessment UI correctly uses unverified evidence wording and states that a form selection alone cannot create verified evidence. This is a documentation/trust consistency issue and should be corrected in a separate bounded content change rather than mixed into the proven layout repair.

The analytics consent banner occupies meaningful screen space on the assessment page. No consent behaviour was weakened or changed in this repair. Any future visual reduction must preserve consent and privacy requirements.

## Scope of this repair

The repair changes only public frontend HTML/CSS and regression coverage. It does not change authentication, authorisation, tenant isolation, PostgreSQL, Stripe, email, Render configuration, runtime policy, evidence trust semantics, Control Intelligence state transitions or deployment-decision logic.
