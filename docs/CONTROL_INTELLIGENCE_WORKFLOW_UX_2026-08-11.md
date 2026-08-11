# Control Intelligence workflow UX repair — 11 August 2026

## Scope

This change repairs the browser workflow, responsive presentation and two server-side workflow defects exposed by the CLARA design-partner assessment. It preserves the underlying evidence trust model: declarations remain distinct from observations, unverified evidence is not promoted, findings still require observed/reproduced failure evidence, and finding closure still requires remediation plus exact retest evidence.

The work is based on observed design-partner use of the CLARA assessment and repository baseline `27ffe490b50f77d7d59c73a40ff5989763bff8e1`.

## Observed problems

The design-partner run exposed workflow friction that was not visible in the earlier generic UX audit:

- all eight evidence-chain stages were rendered together, so future forms were visible before their prerequisites existed;
- the remediation stage showed plan, implementation evidence and remediated-snapshot forms at the same time, making it easy to imply work had been implemented before a changed version existed;
- stage labels such as “What evidence proves it?” overstated the meaning of unverified customer/test evidence;
- the overview rendered a first-eight control preview but also displayed a Load more action whose additional rows were sliced away on re-render, making catalogue coverage unclear;
- bulk applicability used the transactional batch API, so one stale or invalid row discarded every otherwise valid decision in that browser submission;
- responsive navigation still relied on horizontal tab/step patterns that were awkward on narrow screens;
- supporting-fact and impact-fact forms did not sufficiently warn reviewers against selecting unrelated facts merely to advance the workflow.

## Additional root causes found during end-to-end validation

The authenticated browser journey exposed two material server-side workflow defects that were repaired in this change.

### Guided remediation narrative was silently discarded

The remediation UI accepted root cause, corrective action, target environment, rollback plan, validation plan, change reference and limitations, but the server-side verification sanitizer retained only a small legacy allowlist. The UI could therefore report that a remediation plan was saved while most of the guided narrative was not persisted. The previous generic sanitizer also imposed a 200-character string ceiling that was inappropriate for remediation evidence.

The sanitizer now uses an explicit, string-only, bounded field contract:

- `artifactId`: 100 characters;
- `reference`: 500;
- `retestReference`: 500;
- `notes`: 3000;
- `rootCause`: 2000;
- `correctiveAction`: 4000;
- `targetEnvironment`: 500;
- `rollbackPlan`: 2000;
- `validationPlan`: 3000;
- `changeReference`: 500;
- `limitations`: 3000.

This preserves the evidence supplied by the guided remediation forms without accepting arbitrary nested data or unbounded strings.

### Retest could unlock before a remediated snapshot existed

The previous stage-state calculation treated a finding as being in remediation as soon as implementation evidence changed its status. That could mark remediation complete and make exact retest current even though the current system snapshot was still the same snapshot on which the failure had been recorded.

The workflow now requires both:

1. implementation evidence recorded for the open finding; and
2. a current system snapshot different from the original failed-test snapshot.

Until both conditions exist, remediation remains the current stage. If implementation evidence exists but the snapshot has not changed, the next action explicitly asks for a remediated system snapshot before retesting.

A stale variable reference introduced while repairing this state transition was caught by the authenticated browser test before merge and removed.

## Implemented browser changes

### Progressive stage navigation

The control page now adds a compact evidence-chain navigator showing all eight stages with explicit `current`, `complete`, `blocked` or `not required` state. Only the current stage is opened automatically. Completed stages remain available but collapsed.

The customer-facing stage labels are shortened and made evidence-accurate:

1. Applicability
2. Test
3. Evidence
4. Finding
5. Remediation & implementation
6. Exact retest & closure
7. Approval
8. Deployment decision

Evidence wording now says that evidence supports the recorded result and that evidence trust remains explicit. It does not imply that unverified evidence proves a control.

### Remediation sequencing

The browser now treats remediation as three ordered substeps:

1. remediation plan;
2. implementation evidence;
3. remediated snapshot.

Later substeps remain visibly locked until the preceding evidence exists. Saved substeps are collapsed and disabled to reduce accidental blank overwrites. A changed snapshot is recognised by comparing the current snapshot with the original failed execution.

Server-side stage gating now enforces the same order before exact retest can become current.

### Bulk-review failure isolation

The browser no longer uses the all-or-nothing batch endpoint for the interactive bulk-review form. Instead it submits each explicitly reviewed control through the existing individual applicability endpoint.

Consequences:

- each row still has its own immutable decision, reason, supporting facts and optimistic-concurrency digest;
- a stale or invalid row is marked in place;
- already successful rows are not rolled back because another row failed;
- the backend transactional batch endpoint remains unchanged and available to API clients that require atomic behaviour.

No automatic applicability or finding inference was introduced.

### Overview clarity

The overview explicitly states that its control list is a preview and routes the user to the full Controls view. The misleading Load more behaviour on the sliced preview is replaced by a clear `View all controls` action.

### Responsive presentation

Control Intelligence receives a dedicated responsive layer:

- tabs wrap into a grid instead of relying on horizontal scrolling;
- the evidence-chain navigator uses four, two or one columns depending on viewport width;
- control cards and action buttons stack cleanly on narrow screens;
- forms receive bounded, readable card widths and long identifiers remain breakable;
- the full workflow does not depend on a horizontal progress rail.

## Security and evidence invariants preserved

This repair does not:

- promote unverified evidence to verified;
- infer findings from declarations or unknowns;
- close findings without implementation and exact-retest evidence;
- alter the server-derived deployment decision policy;
- weaken snapshot immutability or staleness semantics;
- weaken exact-action approval integrity;
- alter tenant/project authorization;
- add a database or migration.

## Known remaining limitation

The current snapshot architecture-fact vocabulary remains positive-fact oriented and the server still requires at least one confirmed snapshot fact for every applicability decision. The CLARA run showed that this is awkward for some scoped negative or missing-information decisions. That behaviour is intentionally not changed here because it is part of the signed applicability descriptor and server validation contract. A future change should redesign that contract explicitly rather than silently fabricating negative facts in the browser.

## Validation completed before merge

Temporary PR validation ran against the PR merge result and completed successfully on 11 August 2026:

- `npm run check`: passed;
- focused `tests/control-intelligence-ux.test.js`: 7/7 passed;
- full `npm test`: 269 tests total, 268 passed, 0 failed, 1 skipped;
- disposable PostgreSQL 16.14 harness: passed with 19 migrations, 182 foreign keys, snapshot/decision/bulk concurrency checks, transactional bulk rollback, exact approval scope and relational-abuse checks all passing;
- authenticated visible browser journey: passed from registration through workspace/project creation, snapshot creation, bulk applicability, failed test, evidence, finding, remediation plan, implementation evidence, remediated snapshot, exact retest, finding closure, approval and deployment decision;
- narrow mobile viewport at 390 px: no horizontal page overflow;
- post-logout check: assessment project/finding content was not exposed to the logged-out browser.

The authenticated browser validator used visible DOM controls and passed the repository guard that rejects hidden workflow mutation through direct application API calls.

These results validate the branch/PR behaviour. Production must still be verified against the exact merged and deployed commit before the production workflow is described as updated.
