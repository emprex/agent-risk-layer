# Control Intelligence normal-customer journey repair — 17 August 2026

## Evidence source

This repair was driven by the Northstar Support Agent — staging v2.3 synthetic customer journey while signed in as a normal product user. The journey was observed through the live production interface after main commit `70d17eeeb73b906abff21a5ec13679b86108573d`.

## Repository inspection before change

The repository already contains important functionality that must not be duplicated:

- snapshot-derived control suggestions and batch review on the Controls view;
- browser-side failure isolation so bulk applicability rows are saved independently;
- strict planned / passed / failed / inconclusive test states;
- a progressive control journey that keeps evidence and findings blocked until prerequisites exist;
- Controlled attack testing for authorised non-production customer-operated adapter tests;
- integrity-verified Red Team evidence binding for exact remediation/retest lineages;
- explicit evidence trust states and server-owned deployment decisions.

Therefore the problem observed in Northstar is primarily customer guidance and workflow discoverability, not the absence of the underlying evidence model.

## Observed normal-user friction

1. A normal customer can reasonably believe all 108 controls must be opened individually even though architecture-matched suggestions and batch review already exist.
2. `Applicable` is easy to misread as `vulnerable` or `failed`.
3. The control page uses assurance vocabulary that is accurate but assumes security-review experience.
4. The Test stage does not explain clearly enough that this form records a test; it does not independently operate the customer target.
5. `Save as planned` can sound like generic save-progress rather than an explicit non-evidentiary state.
6. After a plan is saved, the relationship `Plan → Execute → Record → Evidence` is not visually explicit enough.
7. Customers are not clearly shown the two realistic execution routes: run the bounded scenario in their authorised environment, or use the specialist Controlled attack testing workspace when a supported Red Team case applies.
8. Advanced digests/provenance are useful but should remain secondary; the current product already largely does this, so no provenance semantics are changed here.

## Implemented repair

A small customer-guidance layer is loaded on Deployment Evidence and focused control pages. It:

- explains that applicability means relevance, not vulnerability or finding;
- reinforces that unknown/missing information remains unknown;
- changes the visible `Save as planned` wording to `Plan only — not executed` without changing the stored status value;
- changes the test action label so a plan is visibly `no evidence yet`;
- adds a four-step visual sequence: Plan → Execute → Record → Evidence;
- explains that Control Intelligence records the test and does not independently operate the target;
- describes a normal bounded customer-operated route and the existing specialist Controlled attack testing route without claiming they are automatically linked;
- adds help under Observed result and Side-effect outcome;
- tells customers on the full Controls view that they do not need to open all 108 controls individually and should start with architecture-matched suggestions plus batch review;
- leaves existing bulk-review failure isolation untouched;
- leaves all server security/evidence semantics untouched.

## Security invariants preserved

This change does not:

- create or infer applicability decisions;
- turn suggestions into applicability;
- turn unknown or inconclusive information into a finding;
- execute customer targets;
- promote a planned test to evidence;
- promote owner-entered evidence to verified evidence;
- alter findings, remediation, retest, approval or deployment-decision derivation;
- alter authentication, tenant isolation, billing, persistence or migrations;
- alter the historical Northstar Critical 44/100 assessment;
- treat Runtime completion as a deployment decision.

## Validation boundary

Focused source regression coverage is included for page loading, applicability wording, planned-test semantics, execution trust boundary, 108-control guidance and responsive layout. The branch must still pass repository `npm run check` and the relevant/full test suite before merge where a runnable checkout is available. Production visual verification is required after deployment.
