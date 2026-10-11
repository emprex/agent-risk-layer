# Operator A–Z capability map — 11 October 2026

**Scope:** source-inspected operator paths at `main` commit `ebe3dd5e35ddf8b423837be147bc2e40980db9b5`. This is a product-delivery gap map, not a security assessment, test execution, compliance attestation or release approval. Distinguish code presence from a verified end-to-end customer journey.

## Current reality

- `npm run operator:open -- <frozen-target>` is a private, content-addressed **read-only** HTML dossier, not a web application or authoritative transaction surface. It shows 108 control statuses and independent evidence queues; controls in `human_decision` do not imply approval.
- `npm run assess:local -- <frozen-target> "<request>"` is the existing transactional CLI. The runner requires local PostgreSQL, checks the clean frozen Git SHA, and invokes `runLocalAssessment`. On a new target, its preflight may initialise an assessment, so never call it as a harmless dry run without scope approval.
- Existing `runLocalAssessment` includes declared-context capture, applicability, manual/human evidence handling, active-test authorisation, test-result recording, remediation and retest, and human decision paths. The CLI paths do **not** establish that a usable, safe UI exists for these operations.
- Local controlled active-test executor currently hard-restricts `Execute authorised active control test` to `ARL-KB-006` (`src/agent/local-assessment-workflow.mjs`). Do **not** present all 108 controls as automatically executable. Manual results and static observations require provenance and review.
- Customer deliverable generation is in `src/agent/arl-local-assessment-runner.mjs`; offline bundle verification and advisory disclosure review have separate `report:verify` and `report:disclosure` scripts. Bundle integrity is **not** an approval signature.
- The local adapter on port 8787 is the separately authorised MCP test target adapter, **not** the Operator frontend.

## Customer journey: observed implementation and missing operator affordances

| Stage | Existing authoritative entry point or evidence | Operator status | Product gap / acceptance requirement |
| --- | --- | --- | --- |
| Request, quote and agreement | Static public site and `OPERATIONS_RUNBOOK.md` describe a service-led intake | Outside offline Operator | Verify real enquiry delivery and human commercial handoff; do not invent billing or hosted accounts |
| Customer/scope and authorisation | `Set assessment context <JSON>`; frozen-target runner preflight | CLI, not an editable UI | Show current scope and explicit reviewed changes before mutation; preserve identity and audit trail |
| Target freeze and assessment selection | `inspectFrozenRepository`, `resolveLocalAssessmentContext`, `ensureInitialAssessmentSnapshot` | SHA visible in read-only dossier | Provide safe target/assessment selection with clear create-vs-open behaviour and no accidental state initialisation |
| Applicability | `parseLocalApplicabilityCommand`, authoritative applicability functions | Status visible, actions CLI | Guided human decision per control, snapshot binding, rationale and required architecture facts; no auto-PASS |
| Source and human evidence | `Show assessment evidence requests`, `Show assessment evidence triage`, manual/human evidence command parsers | Read-only review packs | Guided evidence intake with provenance, permission and reviewer validation |
| Active tests | `Authorise active control test <JSON>`, `Execute authorised active control test <JSON>`, `Record active control test result <JSON>` | No execution from HTML | Explicit ROE, separate approval, bounded execution and result provenance; local executor only KB-006 currently |
| Findings, remediation, exact retest | `Review KB-006 finding`, `closeControlFinding`, `completePersistedExactRetest` | Finding/follow-up status visible | Human-facing finding workflow with disputed attribution, changed revision, retest linkage and no silent closure |
| Human gates/deployment | `recordDeploymentDecision` and explicit human paths | `human_decision` is a **stage**, not consent | Authenticated actor, exact proposed action, evidence and confirmation; leave HOLD until authorised |
| Client report | Deliverable builder/writer, `report:verify`, `report:disclosure` | Separate CLI/export | One guided review/handoff flow with recipient, limitations, human confidentiality review and controlled export |

## First build block — *guided Operator workflow*, no new authority

**Priority P0:** Start with a *read-only, verified next-action panel* derived from the current canonical snapshot/queue in the existing offline HTML. Provide assessment ID, frozen revision, hold/review status, concrete operator workstreams and a safe textual instruction for the next step. Do not embed executable buttons, untrusted raw JSON, secrets, state mutation, or fake approvals. Reuse the canonical queue already read for the dashboard; fail closed on missing or mismatched binding. A stale HTML file must state that it is a point-in-time preparation view.

**Acceptance tests:** fixture with all 108 controls; a finding-open control and human-decision controls cannot be displayed as PASS; no code execution/network/side effects; metadata content escaped and allowlisted; expected SHA/snapshot association; deterministic immutable digest; old tests stay green.

**Priority P1:** After P0, introduce a *separate authenticated local transaction surface*, reusing existing CLI/domain authority APIs for scoped changes. Design permission/actor identity, CSRF, local bind, audit logging and per-action confirmation first. Do **not** convert the offline HTML into an unsafe state-changing page. Progressively cover scope/applicability, evidence, ROE/tests, findings/retests, human decision, report. Verify one authorised synthetic A–Z journey without changing the historical MCP assessment.

**Priority P2:** Validate the complete reproducible customer handoff including disclosure review and commercial operational readiness.

## Immediate non-goals

- No new port/server merely to display information; no Render Operator hosting.
- No further repeat of the completed static-collection preview, no new KB-006 attestation by default, no active target tests.
- No merge of security-semantic tenant-isolation PR #348 without accountable review.
- No synthetic confidence or PASS extrapolated from 108 controls, green CI, or an offline report.

## Source anchors

- `src/agent/arl-local-assessment-runner.mjs` — preflight, dispatch, export
- `src/agent/local-assessment-workflow.mjs` — command/action routes
- `src/agent/offline-operator-review-dashboard.mjs` — offline HTML
- `src/agent/control-work-queue.mjs` — canonical queue lanes
- `src/agent/local-assessment-context.mjs` — local assessment binding
- `docs/OFFLINE_OPERATOR_EVIDENCE_DASHBOARD.md` — read-only guarantees
- `OPERATIONS_RUNBOOK.md` — actual customer operations
- `package.json` — supported product commands

**Next implementation PR:** P0 only; keep product code changes and tests small, gated and observable. This document does not assert all CLI commands are complete or customer acceptance-tested.
