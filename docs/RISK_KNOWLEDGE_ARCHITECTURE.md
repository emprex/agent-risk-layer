# Risk knowledge architecture — ARL-RKA-1.2.0

## Scope and evidence chain

The asset answers what can fail, which assets and trust boundaries are exposed, how to test the condition, what evidence demonstrates the control, and which server-derived deployment decision follows. It reuses the existing assessment, findings, inspection, red-team, runtime event, approval, remediation, retest and project structures through tenant-bound links:

`Declared Controls → Observed Controls → Findings → Red-Team Evidence → Runtime Evidence → Human Approval → Remediation → Retest → Deployment Decision`

The library is decision support, not an accredited certification, proof of compliance, exhaustive coverage or guarantee that a system is risk-free.

## Content, access and lifecycle

Public responses contain the control ID, title, category, plain-English problem and impact, default severity guidance, high-level remediation, informative mappings, version, candidate status and review information. Verified accounts can read exact methods, evidence, positive and negative tests, pass/fail criteria, containment, monitoring, retest requirements and JSON/YAML manifests. No paid restriction was added: the existing billing service is capable but there is no documented product entitlement specifically for risk-knowledge detail. That commercial decision remains unresolved.

Lifecycle states are `candidate`, `internally_reviewed`, `customer_exercised`, `independently_reviewed`, `verified_automation`, `deprecated` and `retired`. Customer exercise requires a real assessment reference. Independent review requires an identified reviewer or organisation and evidence. Verified automation additionally requires executable semantics and fixtures. Entries never promote because of age or usage. All 108 entries migrate to `candidate` because the repository contains no qualifying customer or independent review evidence.

## Applicability and severity

The authoritative predicate registry classifies all 66 facts as user-answerable, derived from answers, system-observed, project-metadata-derived or manual-review-only. Answers are tri-state. Missing inputs and unresolved sources remain Unknown and therefore review-required. Conditional questions reduce irrelevant prompts without fabricating answers. An open finding or active remediation preserves applicability even if a later profile would otherwise exclude the control.

`defaultSeverity` is catalogue guidance. Project context has separate fields for asset sensitivity, reachable systems, action impact, data classification, user population, exploitability, reversibility, exposure, compensating controls, observed evidence, project severity and residual risk. Critical open findings directly cause `do_not_deploy`; lower-impact passing controls cannot average them away. Clients cannot submit readiness scores, evidence counts or deployment gates.

## Integrity, export and policy-as-code

Knowledge records are versioned and checked against their canonical SHA-256 digest when loaded. Evidence links bind the knowledge version and entry digest. A missing, malformed, modified or stale digest fails closed and creates a redacted integrity log event. This is accurately described as “Versioned and digest-bound evidence records,” not tamper-proof storage. SHA-256 does not prove author identity, prevent an authorised database rewrite or replace signed release provenance.

JSON and YAML exports are safely structured. Rego remains unavailable unless an explicit input schema, enforcement point, unambiguous executable semantics, positive and negative fixtures and reviewed tests exist with `verified_automation`. Current entries return: “Machine policy not available for this control.”

## Retention, rollback and monitoring

Project/workspace deletion follows existing foreign-key cascades. Runtime retention removes dependent links before source evidence and expires evidence-backed passing states; it never silently clears an open critical finding. Lifecycle evidence references follow the retention of their authoritative assessment or evidence record.

Rollback should restore the application and database from a verified pre-migration backup. Migrations 013 and 014 are additive; a logical rollback may stop reading their tables while retaining records. Dropping them is not the default rollback because that would discard review and contextual-risk data. Monitor integrity mismatch audit events, failed migrations, stale evidence links, lifecycle mutations, excessive pagination and authorization denials.

## Known limitations and exclusions

- No entry has customer-exercised, independent-review or verified-automation evidence in this repository.
- PostgreSQL migration execution requires a disposable or test PostgreSQL service; the SQLite test adapter is compatibility evidence, not production migration evidence.
- Contextual project-risk storage is additive, but an owner-reviewed write UI/API is intentionally deferred rather than accepting client-derived severity.
- The public fallback filename retains `v1.1` for URL compatibility while its embedded schema and knowledge version are 1.2.
- Framework mappings remain pinned, informative and subject to the source and claims register.

Semantic generation quality for all 108 controls is recorded in `docs/RISK_KNOWLEDGE_SEMANTIC_QUALITY.md` and enforced by a byte-identical second-run test plus canonical JSON, CSV, public JSON and migration agreement checks.
