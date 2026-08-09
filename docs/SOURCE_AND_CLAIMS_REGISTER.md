# Source and claims register

## Control Intelligence Graph

Permitted claim: “AgentRiskLayer Control Intelligence connects a project’s versioned agent architecture to applicable candidate controls, canonical tests, recorded evidence, existing findings, runtime decisions, approvals, remediation, retesting and an evidence-bound deployment decision.” Evidence: migration 015, server implementation and integration/authorization tests.

Boundary: this does not establish certification, accreditation, exhaustive coverage, regulatory approval, independent validation or guaranteed security. Controls remain candidate content. Framework mappings remain informative. No customer outcome, benchmark or time-saved claim is supported.

## Design-partner evidence cases

Permitted claim before live testing: “AgentRiskLayer uses a version-bound design-partner protocol that preserves declarations separately from observed and test-generated evidence, links findings to reproduction evidence, and requires remediation and retest before a fixed-control claim is made.” Evidence: `docs/DESIGN_PARTNER_EVIDENCE_CASE_PROTOCOL.md`.

Boundary: participation in a design-partartner assessment is not a customer relationship, endorsement, independent audit or proof of security. A questionnaire baseline is not a technical finding. No partner name, company, source excerpt, screenshot, result, quote or identifying technical detail may be published without explicit written permission for the exact publication scope. A remediation is not represented as successful until the original failure or a documented equivalent is retested against the remediated system version.

A public evidence case may be claimed only after all publication gates in the protocol are satisfied. Until then, design-partner work remains private assessment evidence.

## ClawHub external reference intelligence and Inspector benchmark

Permitted current claim: “AgentRiskLayer uses the MIT-licensed OpenClaw ClawHub Security Signals frozen research corpus as external reference intelligence and provides a pinned, reproducible workflow for comparing AgentRisk Inspector findings with ClawScan, static-analysis and SkillSpector signals.” Evidence: `docs/EXTERNAL_SECURITY_INTELLIGENCE.md`, `docs/THIRD_PARTY_DATA_REGISTER.md`, the pinned corpus/source-file digests, and the benchmark runner/tests.

Benchmark claim boundary:

- the ClawHub corpus is silver-standard research data, not human-verified vulnerability ground truth;
- comparison metrics are concordance/disagreement metrics, not accuracy, certification, prevalence or product-superiority metrics;
- VirusTotal-derived per-record fields are excluded from the commercial benchmark workflow;
- generic temporary-repository hygiene findings are excluded from comparison so reconstruction artifacts do not create meaningless positives;
- the `eval_holdout` split is reserved for final evaluation and must not be used for Inspector rule development, tuning or threshold selection;
- no quantitative ClawHub/Inspector performance claim is permitted until a complete pinned run finishes with recorded source revision, split digest, Inspector version/policy version, row count, scan-error count and limitations.

There is currently no permitted claim that AgentRiskLayer is more accurate, safer or more effective than ClawScan, SkillSpector, VirusTotal or another scanner based on this corpus.

## Design basis

The catalogue is original AgentRiskLayer content. External standards and guidance are used as informative mappings, not copied control text and not proof of compliance.

## Current authoritative references

| Reference | Version/status | Use and limitation |
|---|---|---|
| OWASP Top 10 for Agentic Applications 2026 | 2026 | Agent-specific threat taxonomy and defensive design reference. Mappings are references. AgentRiskLayer descriptions are original and do not reproduce the source catalogue. |
| OWASP Top 10 for LLM Applications 2025 | 2025 | LLM application risk taxonomy. Mappings are references. AgentRiskLayer descriptions are original. |
| Artificial Intelligence Risk Management Framework (AI RMF 1.0) | 1.0; NIST states that a revision is in progress | Govern, Map, Measure and Manage lifecycle alignment. Mappings remain pinned to 1.0 until a reviewed migration is completed. High-level informative mapping only. |
| Artificial Intelligence Risk Management Framework: Generative Artificial Intelligence Profile | NIST AI 600-1; official publication updated 2026-04-08 | Generative-AI risk and action alignment. High-level informative mapping only. |
| Guidelines for Secure AI System Development | 1.0 | Secure design, development, deployment, operation and maintenance. High-level informative mapping only. |
| OWASP Application Security Verification Standard | 5.0.0 | Application-security verification reference. Section-level mapping only; verify exact requirements against the official release. |
| OWASP API Security Top 10 | 2023 | API authorization, resource, business-flow and inventory risk reference. Category-level mapping only. |
| Guidance on AI and data protection | Current guidance under review after the Data (Use and Access) Act 2025 | UK privacy, fairness, transparency, security, minimisation and rights reference. Informative mapping; legal review is required because the guidance is under review. |
| Regulation (EU) 2024/1689 (Artificial Intelligence Act) | Regulation (EU) 2024/1689 | Regulatory applicability, provider/deployer duties, transparency and post-market governance reference. Legal applicability must be assessed by qualified counsel for the exact role, system and territory. |
| ISO/IEC 42001:2023 Artificial intelligence management system | 2023 | Management-system family alignment. Family-level mapping only. No clause text is reproduced; exact clause mapping requires a licensed copy. |
| ISO/IEC 23894:2023 Artificial intelligence — Guidance on risk management | 2023 | AI risk-management family alignment. Family-level mapping only. Exact clause mapping requires a licensed copy. |

## Review date

- Retrieved/reviewed: 2026-08-05; catalogue engineering review: 2026-08-06
- External intelligence/benchmark claim review: 2026-08-09
- Design-partner publication protocol review: 2026-08-09
- Earliest scheduled entry review: 2026-10-04 (critical entries); each entry follows its own risk-based interval
- Earlier review is required after a material source update, new attack evidence, customer incident, control bypass or architecture change.

## Legal and certification boundary

- Framework mapping is informative and does not establish compliance.
- ISO clause-level mapping requires access to the licensed standards.
- EU and UK legal applicability requires qualified legal analysis for the exact system, role, location and use.
- The ICO AI guidance is currently under review following UK legislative changes; do not freeze it as permanent law.
- Do not claim accreditation, regulatory approval, government approval, EU AI Act certification or guaranteed security.


## ARL-RKA-1.2.0 metric and validation boundary

- OWASP Agentic Top 10: 57 mapping records across 56 unique entries.
- The earlier figure of 82 mapped controls is unsupported and must not be used.
- Mapping counts are informative alignments, not proof that the mapped framework requirement is fully implemented or satisfied.
- Structured applicability predicates are derived from the existing applicability labels. Unknown architecture facts remain review-required.
- Operational metadata is expert-authored candidate metadata. No control is marked as having a verified machine rule or verified full automation in this release.
- All 108 entries remain `candidate`. No age, view, usage or test count promotes lifecycle state. Customer exercise requires a real assessment reference; independent review requires an identified reviewer or organisation and evidence.
- The enriched test content is original expert-authored guidance and has not been represented as an incident history, customer benchmark or independent validation.
