# External agent material target-change handoff — Phase 4

**Internal service only; not yet an operator-facing GUI or public endpoint.**
Depends on the external collector (PR #499) and PostgreSQL candidate bridge (PR #500).

## Purpose

An external agent's release or the operator-approved probe manifest may change without a Git SHA.
Never reuse historical evidence, applicability conclusions, severity or deployment authority across a material change.

The trusted, authenticated owner/admin invokes
transitionExternalTarget with:
- exact current systemSnapshotId as optimistic concurrency guard;
- exact new JSON manifest and current matching time-bounded ROE;
- accountable 40–800 character material-change reason;
- explicit acknowledgeMaterialChange true.

No remote request runs during the handoff. The new manifest's declared version is **not independently attested** and the ROE is **not independently signed** by the actual customer.

## Implementation and safety properties

- Restricts the caller to an active staging project's member with owner/admin role. The user ID must be established by a trusted operator application; never allow the network caller to choose an arbitrary identity.
- Restricts transitions to an existing current external target with the SAME HTTPS endpoint. A new endpoint requires another separately reviewed project and scope.
- A changed declared release OR changed test manifest triggers the transition. An identical version/manifest is not a material change.
- Calls ARL Control Intelligence's existing createSystemSnapshot method with expectedCurrentSnapshotId. Old snapshot evaluations and deployment decisions become stale via its existing transaction.
- Resets **all 108 newly bound evaluations** to unknown applicability, not-evaluated severity, no evaluator; regenerates the exact canonical JSON descriptors and SHA-256 digests atomically. This is necessary because the existing generic snapshot initializer can copy project-level prior applicability.
- Preserves old imported evidence and old snapshot for historical traceability; neither is copied into the new snapshot.
- Writes a metadata-only audit record with old/new snapshot IDs, declared versions, manifest and reason digests.
- Does not import candidate receipts automatically. Only a subsequent separately checked collection for the new manifest may be imported by the existing candidate bridge.

The result always reports HOLD, zero accepted evidence, zero confirmed findings, 108 controls needing reassessment and unknown release authenticity.

## Explicit limitations

- This is a material change of **an external assessment target**, not an authorised assessment or retest.
- The old project-level risk context records may remain in their historical, project-level tables. The new snapshot-bound Control Intelligence evaluations are reset and must be checked before any separate downstream projection makes a decision.
- No cryptographically signed release identity, attested tool-action trace, independent ROE verification, automated findings or report decisions are added here.
- The service is not exposed to the public product. Client authentication and a human UX are separate work items.
- This does not test Meta Muse and must not bypass UK regional access restrictions.

## Validation

Pure tests cover version changes, manifest-only changes, no-change denial, cross-endpoint denial, stale snapshot denial, Git snapshot rejection, operator mismatch and ROE expiry.

The dedicated GitHub Actions disposable PostgreSQL integration exercises an authorised synthetic project. It checks new snapshot creation, 108 integrity-consistent unknown control evaluations, old evidence retained only as history, denial of replayed old-release evidence, stale handoff denial and new-release candidate import without evidence promotion.

No workstation PostgreSQL or customer target is used for CI.
