# PROJECT_STATUS.md — AgentRiskLayer Product / Authority

**Snapshot:** 6 October 2026

This file is intentionally short and dated. Update it when the real project state changes.

## Canonical role

Repository: `emprex/agent-risk-layer`  
Local path: `~/agent-risk-layer`

Current role:
- single canonical AgentRiskLayer product / authority repository;
- public AgentRiskLayer presentation and assessment-request site;
- local operator assessment workflow;
- assessment evidence, remediation/retest, deterministic inspection/red-team and Control Intelligence implementation.

No second ARL repository is part of the active product.

## Verified current repository state

Verified on 6 October 2026:

- local `main` and GitHub `main` are synchronized;
- canonical GitHub main before this cleanup branch: `2f23ea46fa94a96bbae1e96a13b499c2c7883a1c`;
- working tree reported clean after synchronization;
- canonical CI passed for the synchronized local ARL history.

Do not assume these values remain current after this snapshot. Re-check before technical work.

## Active company priority

1. Finish one usable local ARL product.
2. Keep one canonical assessment workflow.
3. Make the operator experience simple enough for real client delivery.
4. Preserve deterministic/human authority boundaries.
5. Continue commercial execution toward real paid assessments.

## Current product direction

The public website is for presentation and assessment requests.

Assessment execution is local and operator-led:

request
-> scope
-> frozen target
-> inspection/evidence
-> applicability
-> explicitly authorised controlled tests
-> findings
-> remediation
-> changed snapshot
-> exact retest
-> report
-> human final decision.

The LLM may assist with explanation, conversation, summarisation and drafting, but it is not authoritative for applicability, evidence validity, severity, finding closure, readiness, controlled-test authorisation or deployment decisions.

## Known cleanup issues

1. Some legacy hosted API modules and terminology remain in the repository and require a controlled dependency audit before removal.
2. The current local assessment CLI still exposes implementation details such as explicit target SHA/environment setup that should eventually be managed by the local operator UX.
3. The local CLI currently uses its isolated SQLite capability; the desired long-term operator architecture should deliberately choose and validate the canonical persistence path rather than accidentally creating two persistence models.
4. README/package metadata still contain legacy hosted/platform descriptions that may not match the current service model.

## Next controlled steps

1. Complete dependency tracing for legacy hosted assessment routes before removing code.
2. Keep the public request flow intact.
3. Preserve the 108-control Risk Knowledge unless a specific defect is demonstrated.
4. Simplify local operator startup and workflow without creating another framework.
5. Prove the complete local customer journey with exact-head tests before declaring the product final.
