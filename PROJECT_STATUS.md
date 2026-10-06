# PROJECT_STATUS.md — AgentRiskLayer Product / Authority

**Snapshot:** 6 October 2026

This file is intentionally short and dated. Update it when the real project state changes.

## Canonical role

Repository: `emprex/agent-risk-layer`  
Local path: `~/agent-risk-layer`

Current role:
- single canonical AgentRiskLayer product / authority repository;
- public AgentRiskLayer presentation and assessment-request site;
- integrated local operator assessment workflow;
- assessment evidence, remediation/retest, deterministic inspection/red-team and Control Intelligence implementation.

No second ARL repository is part of the active product.

## Verified current repository state

Verified on 6 October 2026:

- GitHub `main` is the canonical remote source;
- the previous local/GitHub synchronization completed cleanly before this final GitHub-side cleanup;
- obsolete hosted assessment HTTP routes and wrappers have been removed;
- obsolete remote operator-session modules have been removed;
- local assessment freezes the exact clean target Git SHA automatically;
- local self-proof is bound to `emprex/agent-risk-layer`;
- the component inventory now describes one canonical repository;
- the 108-control Risk Knowledge catalogue remains canonical;
- exact-head CI for the final architecture cleanup passes syntax, focused regressions, unit/integration, scenario regression and detection regression.

The next laptop synchronization should be performed once, after this GitHub cleanup is merged.

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

## Remaining product work

1. The local CLI still exposes implementation-level commands. The final operator UX should hide that complexity behind one understandable local entry point.
2. Local assessment persistence currently uses the isolated SQLite local capability. The final operator architecture must deliberately keep or replace that persistence model; it must not accidentally create two authorities.
3. The complete customer journey still needs one final exact-head end-to-end acceptance run before calling the product finished.
4. Historical documentation and validation archives may still describe older hosted/platform capabilities; they are historical evidence and must not override the current canonical architecture.

## Next controlled steps

1. Keep the public assessment-request flow intact.
2. Preserve the 108-control Risk Knowledge unless a specific defect is demonstrated.
3. Finish the local operator UX without creating another framework or repository.
4. Prove the complete local customer journey with exact-head tests.
5. Perform one final laptop synchronization after GitHub `main` is final and green.
