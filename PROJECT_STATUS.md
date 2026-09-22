# PROJECT_STATUS.md — AgentRiskLayer Product / Authority

**Snapshot:** 22 September 2026

This file is intentionally short and dated. Update it when the real project state changes.

## Canonical role

Repository: `emprex/agent-risk-layer`  
Local path: `~/agent-risk-layer`

Current role:
- canonical AgentRiskLayer product / authority repository;
- source of the live Render service;
- public AgentRiskLayer site;
- product-side assessment, evidence, remediation/retest, deterministic inspection/red-team and Control Intelligence implementation.

## Verified current production state

Verified on 22 September 2026:

- `main` SHA: `1fd38c0415b8c11967572b8b574c89e84378232d`
- Render service: `agent-risk-layer`
- Render source repo: `https://github.com/emprex/agent-risk-layer`
- Render branch: `main`
- auto-deploy: enabled
- live Render deploy is the same SHA: `1fd38c0415b8c11967572b8b574c89e84378232d`

Do not assume these values remain current after this snapshot. Re-check before technical work.

## Active company priority

1. Formalise the assessment methodology.
2. Map applicable requirements to ARL procedures, methods, evidence and human decisions.
3. Prepare the October UKAS discussion with a precise description of the service and questions about the appropriate accreditation route/scope.
4. Continue commercial execution toward real paid assessments.
5. Avoid unnecessary product expansion while the method and operating model are being stabilised.

## Current UKAS / standards position

- ARL is not UKAS accredited.
- ISO/IEC 17020:2026 is a serious current candidate framework for the inspection-style activity.
- The exact applicability, organisation type and accreditation scope for ARL still require authoritative UKAS confirmation.
- Never invent clause requirements or accreditation status.

## Known cleanup issues

These are known state problems, not invitations to refactor everything at once.

1. The repository README/package metadata still contain legacy product/commercial descriptions that may not match the current service model.
2. `emprex/arl-agent-ai` currently contains duplicated product/site material despite being defined as the orchestration layer.
3. Prior ChatGPT-created context files were discussed but were not actually present in the repositories before this configuration branch.

## Paused / separate scopes

Do not reopen unless explicitly requested:
- Guardian product development;
- Prospector development;
- Sebbi-specific work outside an active Sebbi task;
- Codex security research;
- API-security training lab;
- unrelated redesign or pricing experiments.

## Next controlled steps

After this project-truth configuration is reviewed:

1. Reconcile duplicated public/governance pages between this repo and `arl-agent-ai`.
2. Update stale repository documentation so it reflects the current commercial and authority model.
3. Inventory the assessment lifecycle and existing control catalogue against the intended methodology.
4. Build the requirement -> procedure -> method/control -> evidence -> decision -> review matrix.
5. Prepare the UKAS discussion pack and questions.
6. Continue targeted customer acquisition in parallel.

Do not start Step 1 until the configuration files are reviewed and accepted.
