# AgentRiskLayer v4.4.0 Release Validation

Validation date: 25 July 2026

## Release scope

Version 4.4.0 adds a responsive, searchable Help Centre and user manual at
`/help.html`. It covers onboarding, the complete assurance workflow, correct
assessment use, result interpretation, Inspector, controlled Red Team,
remediation and retesting, plans, troubleshooting, limitations and core
AI-agent security vocabulary.

Contextual navigation exposes Help throughout the customer journey. The public
sitemap includes the Help Centre.

## Automated validation

- Unit and integration tests: 41 passed, 0 failed.
- JavaScript syntax validation: passed.
- Inspector release asset build: passed.
- Red Team release asset build: passed.
- Sample Professional PDF build: passed.
- Full commercial smoke journey: passed.
- Help Centre page delivery and required-content assertions: passed.
- Help Centre JavaScript delivery and search-function assertion: passed.
- Deployed application version assertion: 4.4.0.

## Smoke journey coverage

The end-to-end smoke test verified registration, verification, superuser
entitlement, assessment creation, paid report fulfilment, PDF delivery,
subscription activation, private/public token isolation, local inspection,
signature and replay controls, controlled Red Team authorisation and repeated
trials, export, password recovery and account deletion.

## Product boundary

This validation establishes release reproducibility and functional controlled-
beta readiness. Independent penetration testing, legal review and independent
accessibility assurance remain external professional assurance activities.
