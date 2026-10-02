# Compliance Evidence Agent — MVP

## Product goal

Build a commercial evidence-operations agent that helps organisations collect, organise and prepare compliance evidence without allowing an LLM or automation to become the authority for evidence validity, control applicability, control satisfaction, readiness, certification or accreditation claims.

The commercial promise is operational:

> Connect your evidence sources, see what proof exists, what is missing, and what needs human review before an audit.

This capability is part of the canonical AgentRiskLayer product/authority repository. A conversational operator may later be exposed from `emprex/arl-agent-ai`, but evidence authority and persistence remain here.

## MVP workflow

```text
SOURCE
-> COLLECT ARTIFACT METADATA
-> NORMALISE PROVENANCE
-> PROPOSE CONTROL MAPPINGS
-> CREATE EVIDENCE CANDIDATES
-> HUMAN ACCEPT / REJECT / NEEDS CONTEXT
-> GAP VIEW
-> AUDIT PACK EXPORT
```

## Initial source scope

Phase 1 is intentionally narrow:

1. GitHub repositories and workflow evidence.
2. Uploaded policy/evidence documents.
3. Manual evidence records.

Later connectors may include Google Drive, ticketing, cloud configuration, identity providers and HR systems.

## Framework strategy

The engine must not embed unlicensed standards text.

Framework packs store identifiers and customer-provided/licensed metadata. Public/open frameworks can include their public descriptions when licensing permits. ISO or other copyrighted standards should use control identifiers plus customer-owned mapping metadata, not copied standard text.

## Evidence candidate contract

Every candidate must include:

- immutable candidate id;
- source type;
- source locator;
- collected-at timestamp;
- content digest;
- observed facts;
- proposed control ids;
- mapping rationale;
- limitations;
- review status.

Every newly collected candidate starts as:

```json
{
  "reviewStatus": "pending_human_review",
  "authority": "human_required"
}
```

The collection/mapping agent must never emit:

- `controlSatisfied: true`;
- `verified: true`;
- `certified: true`;
- deployment/readiness approval;
- finding closure.

Those belong to explicit authoritative workflows.

## Human review decisions

A reviewer may record one of:

- `accepted`
- `rejected`
- `needs_context`

The decision record should identify the human reviewer, timestamp, reason and candidate digest.

A human acceptance means only that the evidence candidate was accepted for the stated purpose. It does not automatically mean the mapped control is satisfied.

## Gap model

For each in-scope control, the UI can show:

- no candidate evidence;
- candidates pending review;
- accepted evidence exists;
- evidence rejected;
- more context requested.

This is an evidence-operations status, not a compliance score.

## Phase 1 deliverables

- deterministic evidence-candidate model;
- authority guard;
- candidate grouping/gap summary;
- unit tests;
- GitHub collector adapter;
- evidence review API;
- minimal dashboard;
- exportable evidence manifest.

## Commercial UX target

The first useful dashboard should answer:

1. What evidence did we find?
2. Where did it come from?
3. Which controls might it support?
4. Why was it mapped there?
5. What are the limitations?
6. Who reviewed it?
7. What still has no accepted evidence?

## Non-goals for MVP

- autonomous certification;
- automatic ISO/SOC 2 attestation;
- replacing an auditor;
- automatically deciding applicability;
- automatically deciding control satisfaction;
- generating legal/compliance guarantees;
- unrestricted credentialed crawling.

## Security model

Collectors are least-privilege and read-only by default.

Every candidate is provenance-bound using a digest. Review decisions bind to the candidate digest so later content changes cannot silently inherit an old human decision.

## Next implementation step

After the model layer is merged, implement a read-only GitHub collector that can ingest repository metadata, selected files, branch protection/ruleset evidence where permitted, and workflow-run evidence into this candidate contract.
