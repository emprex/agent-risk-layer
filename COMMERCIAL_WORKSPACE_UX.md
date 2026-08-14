# AgentRiskLayer commercial workspace UX

Status: controlled presentation-layer refactor introduced 14 August 2026.

## Purpose

Separate the public marketing experience from a calmer authenticated security workspace so a customer can answer, in order:

1. What is the current deployment posture?
2. Why?
3. What should I do next?
4. What evidence supports the answer?

The refactor is intentionally presentation-layer only. It does not change assessment scoring, finding semantics, control applicability, evidence provenance, runtime policy, approval binding, remediation lineage, retest rules, billing, authentication or database behaviour.

## Scoped surfaces

The new workspace layer is loaded only on:

- `dashboard.html`
- `result.html`
- `control-intelligence.html`
- `assessment.html`

Public marketing pages do not load `workspace-ux.css` or `workspace-ux.js`.

## Behaviour

### Dashboard

- keeps one recommended action visually dominant;
- moves secondary shortcuts and progress into progressive disclosure;
- groups repeated assessments for the same named agent/type so history is available without appearing as duplicated current work;
- preserves all underlying assessment records and actions.

### Result

- keeps the server-derived assessment decision first;
- shows compact counts for declared findings and information gaps;
- shows the first findings before progressively disclosing the rest;
- preserves the full finding sections, technical details, evidence states, report download and paid workflow;
- keeps unknown information separate from vulnerabilities.

### Control Intelligence

- presents the feature in customer language as deployment evidence while retaining the Control Intelligence name;
- reads the existing project Control Intelligence endpoint and surfaces the recorded deployment state, rationale, blocker counts and next action;
- never invents a deployment decision when none is recorded;
- moves supporting counts, system digest and capability provenance behind progressive disclosure;
- preserves the existing control, evidence-chain and deployment-decision views.

### Assessment

- keeps the questionnaire and submitted answers unchanged;
- replaces the intimidating raw step denominator in the visible UI with five understandable progress sections;
- continues to present one question at a time;
- preserves `I'm not sure` / unknown semantics and evidence qualification.

## Trust boundary

This UX layer may reorganise and summarise information already returned by existing product APIs. It must not upgrade evidence trust, convert unknowns into findings, convert declarations into observations, or infer a deployment approval that the server has not recorded.

## Validation required before production declaration

- JavaScript syntax check for `workspace-ux.js`;
- balanced CSS block validation for `workspace-ux.css`;
- HTML parse/reference check for all four scoped pages;
- repository diff review confirming no backend, migration, auth, billing, evidence or policy file changed;
- browser acceptance on dashboard, result, Control Intelligence and assessment after deployment;
- mobile-width acceptance for the same four surfaces.

A successful UX review does not itself establish that the assessed AI agent is secure. AgentRiskLayer remains proprietary decision support, not accredited certification or a guarantee that a system is risk-free.
