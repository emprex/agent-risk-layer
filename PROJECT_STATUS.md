# PROJECT_STATUS.md — AgentRiskLayer Product / Authority

**Verified snapshot: 10 October 2026.** This is an operating snapshot, not a claim of customer security assurance. Check GitHub and the local PostgreSQL assessment before relying on a live revision or status.

## Canonical architecture

- **One repository:** `emprex/agent-risk-layer` (`~/agent-risk-layer` on Debian).
- **Public website:** static presentation and assessment-request pages; Render does not host an ARL application server or ARL database.
- **Security assessment:** local, human-led Operator using the canonical repository and a separately authorised target.
- **Persistence:** local PostgreSQL via `DATABASE_URL`; SQLite is **test-only**, not a competing product authority.
- **Target:** separately frozen Git repository; target SHA, snapshot lineage, scope and Rules of Engagement must remain bound.
- **Risk Knowledge:** ARL-RKA-1.2.0, 108 candidate controls. A catalogue definition, mapping or green CI does not validate an actual customer control.
- **Authority:** the LLM does not decide applicability, evidence validity, confirmed findings, severity, closure, readiness, authorisation of active tests or deployment.

Do not revive sibling ARL orchestration repositories, hosted Operator sessions, Render product persistence, Stripe or subscription checkout.

## Verified development state

- **KB-024 / migration 047** is merged.
- **KB-025 / migration 048** is in PR #348 pending accountable semantic/code review. A merged migration is not evidence of target security; no tenant-isolation PASS has been established.
- **PR #349** fixed Git fixture commits inheriting a Debian signing-agent requirement; the correction is in `main`.
- **PR #350** introduced an offline evidence-first work plan in the Operator, keeping HTML static, no-script and non-authoritative.
- Debian `npm run check` succeeded; after a temporary process-local signing override, `npm test` reported 861 tests, 854 passed, 0 failed, 7 skipped. The signing regression was subsequently corrected in code.
- The local `operator:open` command generated a verified HTML preparation dossier for the existing frozen MCP-Agent target: 98 independent review controls, 10 excluded/held, 197 missing static observations, 119 human evidence requirements and 191 separately authorised runtime requirements. These numbers are **specific to that preparation snapshot**, not results or PASS/FAIL.
- **Deployment HOLD remains in force.** No full customer A→Z security verdict or accountable final release decision has been demonstrated by the offline dashboard or synthetic CI.

The user-controlled Debian checkout must be synchronized only after an intentional reviewed merge; GitHub CI does not automatically update Debian.

## Commercial priority

Deliver one credible, reproducible, paid, human-led agent security assessment:

request → agreed scope and authorisation → clean exact-SHA target freeze → deterministic inspection and evidence → applicability review → separately authorised bounded tests → human finding decisions → remediation → changed snapshot → exact retest → customer report → accountable final decision.

A review dashboard is a **preparation artefact**, not the authoritative place to record human decisions. Existing PostgreSQL state, snapshot-bound tests and accountable workflows remain authoritative.

## Remaining acceptance gates

1. Validate public static pages and the **actual configured request-delivery channel** without assuming a hosted ARL API.
2. Exercise the local Operator against an approved frozen staging scope; reconcile its missing source, human and runtime evidence before claiming coverage.
3. Require written test Rules of Engagement; never infer permission from a synthetic demo or read-only dossier.
4. Trace a real observed finding through human triage, remediation, exact changed-version retest and an evidence-limited customer report.
5. Record the final human deployment decision only where all blocking criteria are satisfied; otherwise preserve HOLD.
6. Finish issue #214's inventory, entrypoint, migration, version, release and guardrail audits with exact-head CI and human acceptance. Do not declare the product finished solely because unit tests pass.

## Routine commands (owner-controlled Debian)

```bash
# From ~/agent-risk-layer after a reviewed GitHub merge:
git pull --ff-only origin main
npm run check
npm test

# Use only the existing, authorised, clean frozen target:
npm run operator:open -- "$HOME/arl-target-mcp-agent"
```

The Operator may create initial assessment state in local PostgreSQL when no prior binding exists. Its offline HTML review export does not run active tests or grant authority. **Do not modify the frozen MCP target merely to satisfy a test.**
