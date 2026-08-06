# Risk knowledge architecture — ARL-RKA-1.2.0

## Scope and evidence chain

The asset answers what can fail, which assets and trust boundaries are exposed, how to test the condition, what evidence demonstrates the control, and which server-derived deployment decision follows. It reuses the existing assessment, findings, inspection, red-team, runtime event, approval, remediation, retest and project structures through tenant-bound links:

`Declared Controls → Observed Controls → Findings → Red-Team Evidence → Runtime Evidence → Human Approval → Remediation → Retest → Deployment Decision`

The library is decision support, not an accredited certification, proof of compliance, exhaustive coverage or guarantee that a system is risk-free.

## Content, access and lifecycle

Public responses contain the control ID, title, category, plain-English problem and impact, explicit context-required severity metadata, distinct default priority, high-level remediation, informative mappings, version, candidate status and review information. Verified accounts can read exact methods, evidence, positive and negative tests, pass/fail criteria, containment, monitoring, retest requirements and JSON/YAML manifests. No paid restriction was added: the existing billing service is capable but there is no documented product entitlement specifically for risk-knowledge detail. That commercial decision remains unresolved.

Lifecycle states are `candidate`, `internally_reviewed`, `customer_exercised`, `independently_reviewed`, `verified_automation`, `deprecated` and `retired`. Customer exercise requires a real assessment reference. Independent review requires an identified reviewer or organisation and evidence. Verified automation additionally requires executable semantics and fixtures. Entries never promote because of age or usage. All 108 entries migrate to `candidate` because the repository contains no qualifying customer or independent review evidence.

## Applicability and severity

The authoritative predicate registry classifies all 66 facts as user-answerable, derived from answers, system-observed, project-metadata-derived or manual-review-only. Answers are tri-state. Missing inputs and unresolved sources remain Unknown and therefore review-required. Conditional questions reduce irrelevant prompts without fabricating answers. An open finding or active remediation preserves applicability even if a later profile would otherwise exclude the control.

Risk severity is contextual. Catalogue controls do not carry a universal severity rating. AgentRiskLayer assigns severity only after evaluating the control against a specific agent’s access, data, authority, exposure, safeguards and potential impact. A null catalogue severity means project context is required; it does not mean the risk is low or absent.

The shared semantic model keeps catalogue `severity` nullable for compatibility and adds `severityStatus`, `severityModel='project_contextual'` and `severityScope='project'`. Status transitions are scope-driven: catalogue entries are `context_required`; applicable but unassessed project controls are `not_evaluated`; assessed values are `evaluated`; missing architecture facts are `insufficient_information`; excluded controls are `not_applicable`. `defaultPriority` remains the existing P0/P1/P2 operational priority and is not a severity proxy. Null values are neither filtered nor sorted as Low.

Existing tenant-bound `project_risk_context` records supply evaluated project severity and available attribution. The model already stores asset sensitivity, reachable systems, action impact, data classification, user population, exploitability, reversibility, exposure, compensating controls, observed evidence, project severity, rationale, evaluator, evaluation time and residual risk. No second severity store or migration is required. Evaluated Critical open findings directly cause `do_not_deploy`; an open finding without evaluated severity remains on hold and cannot pass. Lower-impact passing controls cannot average blockers away. Unknown context remains review-required. Clients cannot submit severity through the current API, readiness scores, evidence counts or deployment gates.

## Integrity, export and policy-as-code

Knowledge records are versioned and checked against their canonical SHA-256 digest when loaded. Evidence links bind the knowledge version and entry digest. A missing, malformed, modified or stale digest fails closed and creates a redacted integrity log event. This is accurately described as “Versioned and digest-bound evidence records,” not tamper-proof storage. SHA-256 does not prove author identity, prevent an authorised database rewrite or replace signed release provenance.

JSON and YAML exports are safely structured. Rego remains unavailable unless an explicit input schema, enforcement point, unambiguous executable semantics, positive and negative fixtures and reviewed tests exist with `verified_automation`. Current entries return: “Machine policy not available for this control.”

## Retention, rollback and monitoring

Project/workspace deletion follows existing foreign-key cascades. Runtime retention removes dependent links before source evidence and expires evidence-backed passing states; it never silently clears an open critical finding. Lifecycle evidence references follow the retention of their authoritative assessment or evidence record.

Rollback should restore the application and database from a verified pre-migration backup. Migrations 013 and 014 are additive; a logical rollback may stop reading their tables while retaining records. Dropping them is not the default rollback because that would discard review and contextual-risk data. Monitor integrity mismatch audit events, failed migrations, stale evidence links, lifecycle mutations, excessive pagination and authorization denials.

## Known limitations and exclusions

Control Intelligence migration 015 adds immutable system snapshots and snapshot-bound evaluations, executions, evidence and deployment decisions for new records. Existing pre-015 project-risk and evidence records remain historical and are not silently transferred. See `CONTROL_INTELLIGENCE_GRAPH.md`.

- No entry has customer-exercised, independent-review or verified-automation evidence in this repository.
- PostgreSQL migration execution requires a disposable or test PostgreSQL service; the SQLite test adapter is compatibility evidence, not production migration evidence.
- Contextual project-risk storage is additive, but an owner-reviewed write UI/API is intentionally deferred rather than accepting client-derived severity.
- Existing project severity records are not yet bound to a stored assessed-agent configuration version or scoring-policy version. Architecture changes preserve the assessment conservatively and require reviewer reassessment; the API does not fabricate those unavailable attribution fields.
- The public fallback filename retains `v1.1` for URL compatibility while its embedded schema and knowledge version are 1.2.
- Framework mappings remain pinned, informative and subject to the source and claims register.

Semantic generation quality for all 108 controls is recorded in `docs/RISK_KNOWLEDGE_SEMANTIC_QUALITY.md` and enforced by a byte-identical second-run test plus canonical JSON, CSV, public JSON and migration agreement checks.
