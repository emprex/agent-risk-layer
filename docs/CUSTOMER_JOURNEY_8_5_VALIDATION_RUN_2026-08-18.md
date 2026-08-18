# Customer journey 8.5 validation run — 18 August 2026

This run is deliberately non-invasive. Production application code is not changed by this validation branch. The branch adds regression coverage only, then relies on the repository CI suite before any merge.

Baseline main: `bdd38c5e736818b7db10139e39a21bbd68c14d74`.

Validation order:

1. Source gate for PAY fail-closed billing truth and no static billing overclaim.
2. Source gate for result -> checkout -> same assessment -> fix continuity.
3. Source gate for findings-first remediation, owner and bounded retest semantics.
4. Source gate for evidence chain and human-accountable deployment decision.
5. Source gate for selected-agent return continuity.
6. Full CI: syntax, unit/integration, 1,000 scenario regression and detection regression.
7. Only after CI is green: production/browser verification. No payment, remediation closure or deployment-state claim is accepted without observed production evidence.

Failure rule: any failed gate reopens only the affected journey stage. Do not compensate with unrelated feature work and do not merge a failing validation branch.
