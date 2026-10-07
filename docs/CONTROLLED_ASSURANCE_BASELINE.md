# ARL Controlled Assurance Baseline

Status: CONTROLLED ENGINEERING REFERENCE / PRE-ACCREDITATION

This repository view aligns the product with the controlled ARL records already maintained outside the repository. It does not replace those controlled records and does not create an accreditation, certification, or conformity claim.

## UKAS route boundary

Current route status: **UKAS confirmation required**.

Primary working hypothesis: **ISO/IEC 17020:2026** for the current human-led inspection/assessment service.

Alternative route retained for clarification: **ISO/IEC 17065** if AGENTRISKLAYER LTD later operates a formal certification activity.

Controlled source: **ARL Accreditation Route & Scope Decision Record v0.1**.

The current commercial output remains an evidence-backed security assessment and remediation/retest service. The LLM is not the security authority and may not independently decide applicability, evidence validity or sufficiency, findings, severity, requirement satisfaction, closure, readiness, accreditation, certification, or deployment.

## Controlled organisational records

The following records already exist and must not be represented by the product as simply "missing documentation":

- ARL-AASC Impartiality, Conflict of Interest & Independence Procedure v0.1
- ARL-AASC Competence & Authorisation Framework v0.1
- ARL-AASC Scheme Validation Plan v0.1
- ARL-AASC VAL-PILOT-001 Working Pack
- ARL-AASC VAL-PILOT-001 Closeout & Validation Analysis v0.1
- ARL-AASC Evidence Handling & Integrity Procedure v0.1
- ARL-AASC Complaints & Appeals Procedure v0.1
- ARL-AASC Management System, Internal Audit & Management Review Procedure v0.1

These records are controlled pre-accreditation evidence. They do **not** mean the applicable UKAS route is confirmed or that all organisational requirements are complete.

Known open boundaries include route confirmation, founder-concentration / independence treatment, independent-review capability where required, certification-decision authority, and incomplete method-validation / pilot evidence.

## OWASP 2026 technical coverage

ARL uses the OWASP Top 10 for Agentic Applications 2026 and OWASP Top 10 for LLM Applications 2026 as technical threat/risk references.

The catalogue must retain at least one explicit mapping for every:

- ASI01 through ASI10
- LLM01 through LLM10

CI enforces this mapping coverage. OWASP mappings are technical coverage evidence only; they are not accreditation or certification evidence.

## Product evidence rules

For the current 108-control assessment engine:

1. Evidence is bound to the exact target/version and authoritative assessment snapshot.
2. Machine-observable evidence is collected before asking the operator for human-only facts.
3. Runtime or adversarial checks remain separately classified and never become source-inspection evidence.
4. Active/bounded testing requires explicit authority where the workflow requires it.
5. Missing, unknown or inconclusive evidence never becomes PASS.
6. Findings preserve remediation and exact-retest lineage.
7. LLM output may organise or explain evidence, but does not decide evidence validity, finding closure, severity, accreditation, certification, or deployment.
8. Final deployment and residual-risk decisions remain accountable-human decisions.

## Engineering acceptance rule

A change that makes the workflow easier must not weaken provenance, authority, independence, or claims boundaries.

A change that improves UKAS/OWASP presentation must not claim route confirmation, accreditation, certification, or control satisfaction that the underlying evidence does not support.
