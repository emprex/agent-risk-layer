# External AI agent authoritative import bridge — staging only

Status: candidate integration, not a completed customer assessment.

This stacked change depends on PR #499 (bounded external collector and offline consistency verifier). No existing Git Operator entry point is replaced.

## What is implemented

- Migration 060: additive provenance tables binding candidate collections and control/probe links to project, workspace, current system snapshot, and canonical evidence.
- Pure prepareExternalCandidateImport: verify exact manifest, ROE, receipt, timing and control mappings. Internal hash consistency is not cryptographic source authenticity.
- Pure externalCandidateSnapshotInput: a typed external HTTPS target with declared version, no fake Git SHA, and versionVerified=false.
- importExternalCandidateEvidence: an internal, privileged service that reuses Control Intelligence createSystemSnapshot and recordControlEvidence, inside a transaction.

## Operational constraints

The service is intentionally NOT exposed through a public HTTP route or a CLI accepting arbitrary user IDs. A future authorised operator entry point must resolve the actor identity from a trusted authenticated session.

It permits only an active dedicated staging project with existing developer, admin or owner membership. It refuses importing candidates into Git snapshots or external snapshots with another endpoint, declared release or manifest. A new material target version requires an explicit changed-snapshot workflow that is not yet implemented.

The source manifest, ROE and observation record must match byte-for-byte through the prior offline verifier. Operator-entered ROE data is not independent proof of the customer's authorisation or the live endpoint's identity.

Repeated collection IDs are rejected. A new unique collection ID may be imported only if the target version, endpoint and exact manifest remain unchanged.

Each imported control/probe candidate becomes an existing canonical control_evidence_items row:
- evidence_class: imported
- source_type: external_candidate
- verification_state: unverified
- exact system_snapshot_id and risk-control identity
- evidence limitations and digest-linked private source reference

The new provenance tables store only collection IDs, content digests, declared version, scoped actor and snapshot references. Raw agent responses and secrets are not stored in this bridge.

No automatic applicability, validated control PASS, test execution outcome, confirmed finding, severity, remediation closure, readiness, or deployment decision is created. Unverified imported HTTP metadata is not proof that a tool side effect occurred or was blocked.

## Validation

The dedicated PostgreSQL CI test is isolated to the disposable localhost database arl_ci; it does not use a real target or make outbound requests. It tests snapshot binding, 108-control initialization, candidate evidence state, duplicate rejection, version mismatch, and unauthorised actor denial.

The Git-based ARL Operator remains unchanged. The existing customer's local PostgreSQL data is untouched by GitHub CI.

## Not yet implemented

- Authenticated customer-facing external assessment creation and operator UI.
- Signed owner ROE and release/build identity verification.
- Independently observed tool results and before/after state proof.
- External changed-release snapshot handoff, remediation, exact retest.
- Human-reviewed finding decisions and customer report integration.

Do not claim Meta Muse has been tested. UK Muse access is unavailable and no authorised Meta test was performed.
