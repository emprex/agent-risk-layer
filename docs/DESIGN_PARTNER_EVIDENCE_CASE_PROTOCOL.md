# Design-Partner Evidence Case Protocol

## Purpose

This protocol turns an authorised design-partner assessment into a reproducible evidence case rather than a testimonial. It is designed for the AgentRiskLayer evidence chain:

Declared Controls → Observed Controls → Findings → Red-Team Evidence → Runtime Evidence → Human Approval → Remediation → Retest → Deployment Decision.

The protocol is deliberately publication-safe: a design partner is not named, quoted, linked or described in public material unless the owner of the assessed system gives explicit written permission for the exact publication scope.

## Evidence case identity

Every case must bind to:

- case identifier;
- assessed system name or private pseudonym;
- exact commit/build/version;
- assessment date and timezone;
- AgentRiskLayer version, Inspector version and control profile version;
- assessor/operator roles;
- scope and exclusions;
- authorised data class and sandbox constraints;
- whether the assessor directly operated the target or observed owner-executed tests.

If the exact assessed commit/build is unknown, the case remains `scope_pending` and no technical result is represented as version-bound evidence.

## Required states

### 1. Declared baseline

Record what the system owner says is true. Declarations remain `declared` or `unverified` until linked to evidence or observed in a bounded test.

Required fields:

- declaration;
- source and timestamp;
- affected control(s);
- evidence offered but not yet reviewed;
- conflicts or unresolved information.

### 2. Artifact observation

Review authorised artifacts such as policy files, schemas, redacted receipts, configuration, logs or source excerpts.

For every artifact record:

- filename/type;
- exact digest where practical;
- system version/commit binding;
- review method;
- what the artifact demonstrates;
- what it does not demonstrate.

Artifact presence alone is not a passed control.

### 3. Reproduction / bounded test

Each test must define before execution:

- test identifier;
- control objective;
- hypothesis;
- preconditions;
- exact safe action and parameters;
- expected safe result;
- expected unsafe/failure result;
- permitted side effects;
- explicit exclusions;
- rollback/recovery;
- evidence to capture.

High-impact or external actions require exact-action approval before execution. A test must not rely on a control that is already known to be non-enforcing to make the test safe.

### 4. Finding

A finding requires observed or test-generated evidence, not only a questionnaire answer.

Record:

- finding identifier;
- affected system/version;
- control;
- evidence references;
- reproduction steps;
- impact and realistic attack/failure path;
- severity with reasoning;
- limitations;
- remediation owner;
- deployment impact.

Unknown information remains an information requirement, not a vulnerability.

### 5. Remediation

Record the exact change intended to address the finding:

- remediation owner;
- change/commit/version;
- expected control effect;
- implementation evidence;
- rollback path;
- residual-risk statement.

### 6. Retest

Retest the original reproduction, not a weakened substitute. A retest must bind to the remediated version and record the same material action/parameters or a documented equivalent.

Result states:

- `passed` — original failure no longer reproduces and required control evidence is present;
- `failed` — original or materially equivalent failure still reproduces;
- `inconclusive` — evidence or scope is insufficient.

### 7. Deployment decision

The deployment decision must be derived from current evidence for the exact system snapshot. Prior versions do not satisfy the current gate.

## First-session test order

For an action-governance agent, prioritise the boundary between model proposal, policy adjudication and executable action:

1. **Deny enforcement** — harmless sandbox action that policy should deny; determine whether execution still occurs.
2. **Decision/action binding** — change target or parameter after adjudication; determine whether the modified action can execute under the original decision.
3. **Replay** — reuse a prior accepted action/nonce/receipt; determine whether it can execute again.
4. **Policy provenance** — determine whether the receipt identifies the exact policy/version that produced the decision.
5. **Canonicalisation** — equivalent target/path/command encodings; determine whether classification changes unexpectedly.
6. **Indirect untrusted input** — synthetic untrusted content attempts to influence a harmless sandbox action.
7. **Approval integrity** — if approval exists, mutate target/parameters/value after approval and verify rejection.
8. **Containment** — verify the documented stop/revoke mechanism on a harmless controlled sequence.

The sequence may be shortened if the owner-authorised scope is narrower. Forbidden credential paths, environment files, system directories or third-party quota-consuming services must not be exercised without explicit per-test authorisation.

## Minimum publishable case

A public evidence case requires all of the following:

- exact assessed version/commit;
- explicit written permission for publication;
- at least one observed/test-generated control result;
- evidence chain sufficient to reproduce the claim;
- remediation evidence if a finding is presented as fixed;
- retest evidence if a remediation success is claimed;
- explicit scope/exclusions and limitations;
- no secrets, private source, personal data or customer identifiers unless separately authorised;
- partner review of the final public text before publication.

A baseline questionnaire by itself is **not publishable as a security case study**.

## Permission record

Before publication retain a written permission record containing:

- exact case title;
- system/company/name allowed to be shown;
- exact technical facts allowed to be shown;
- screenshots/log extracts allowed to be shown;
- whether quotes are permitted;
- publication channels;
- approval date;
- approving person/role;
- revocation/contact process.

Silence, participation in testing or sending artifacts is not publication consent.

## Public wording boundary

Preferred:

> AgentRiskLayer Security Assessment — assessed against AgentRiskLayer Control Profile vX.Y. The case records declared controls, observed/test evidence, remediation and retest for the scoped system version. This proprietary assessment is not an accredited certification or a guarantee that the system is risk-free.

Do not use:

- “certified by AgentRiskLayer”;
- “proved secure”;
- “independently audited” when the owner executed the test under screen-share observation;
- “customer” unless a commercial relationship actually exists;
- “fixed” without a successful version-bound retest.

## Internal case checklist

- [ ] scope authorised
- [ ] exact commit/build bound
- [ ] baseline preserved
- [ ] artifacts hashed/referenced
- [ ] tests pre-registered
- [ ] side effects bounded
- [ ] test evidence captured
- [ ] findings evidence-linked
- [ ] remediation version recorded
- [ ] original failures retested
- [ ] deployment decision derived from current evidence
- [ ] publication permission obtained
- [ ] public text partner-reviewed
- [ ] limitations included
