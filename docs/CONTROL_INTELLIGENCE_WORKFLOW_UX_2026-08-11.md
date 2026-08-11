# Control Intelligence workflow UX repair — 11 August 2026

## Scope

This change repairs the browser workflow and responsive presentation of Control Intelligence without changing the underlying evidence, finding, remediation, retest, approval or deployment-decision trust semantics.

The work is based on observed design-partner use of the CLARA assessment and the current repository baseline `27ffe490b50f77d7d59c73a40ff5989763bff8e1`.

## Observed problems

The design-partner run exposed workflow friction that was not visible in the earlier generic UX audit:

- all eight evidence-chain stages were rendered together, so future forms were visible before their prerequisites existed;
- the remediation stage showed plan, implementation evidence and remediated-snapshot forms at the same time, making it easy to imply work had been implemented before a changed version existed;
- stage labels such as “What evidence proves it?” overstated the meaning of unverified customer/test evidence;
- the overview rendered a first-eight control preview but also displayed a Load more action whose additional rows were sliced away on re-render, making catalogue coverage unclear;
- bulk applicability used the transactional batch API, so one stale or invalid row discarded every otherwise valid decision in that browser submission;
- responsive navigation still relied on horizontal tab/step patterns that were awkward on narrow screens;
- supporting-fact and impact-fact forms did not sufficiently warn reviewers against selecting unrelated facts merely to advance the workflow.

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

This is a presentation/workflow guard. Server-side prerequisites and closure integrity remain authoritative.

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
- change deployment-decision derivation;
- change snapshot immutability or staleness semantics;
- weaken exact-action approval integrity;
- alter tenant/project authorization;
- add a new database or migration.

## Known remaining limitation

The current snapshot architecture-fact vocabulary remains positive-fact oriented and the server still requires at least one confirmed snapshot fact for every applicability decision. The CLARA run showed that this is awkward for some scoped negative or missing-information decisions. That behaviour is intentionally not changed in this browser-only repair because it is part of the signed applicability descriptor and server validation contract. A future change should redesign that contract explicitly rather than silently fabricating negative facts in the browser.

## Validation required before merge

- `npm run check`
- full `npm test`
- focused `tests/control-intelligence-ux.test.js`
- authenticated browser journey through applicability, failed test, evidence, finding, remediation, changed snapshot and exact retest
- desktop and narrow mobile overflow check

Production should only be described as updated after the merged commit is deployed and the affected authenticated journey is exercised against that deployment.
