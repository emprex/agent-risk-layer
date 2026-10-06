# AgentRiskLayer operations runbook

This runbook covers the public website/request service and the local assessment product.

## Public service checks

For the deployed website:

- confirm homepage, assessment, trust and request pages are reachable;
- check `/api/health` and `/api/ready`;
- review deployment logs and operational alerts;
- verify assessment-request intake;
- verify email delivery if configured;
- review account/workspace access where authenticated surfaces are intentionally retained.

## Local assessment operations

The canonical assessment workflow runs locally from `~/agent-risk-layer`.

Before starting customer work:

1. confirm `main` is the intended reviewed revision;
2. confirm the target repository is authorised and in scope;
3. require a clean frozen target before authoritative inspection;
4. record scope and Rules of Engagement before controlled testing;
5. never let an LLM decide applicability, severity, evidence validity, closure, readiness or deployment;
6. preserve exact revision/snapshot lineage;
7. retest the exact affected control after remediation;
8. require the final accountable human decision.

## Incident handling

If the public website has an operational incident:

- protect assessment-request data;
- preserve logs/evidence needed for diagnosis;
- disable affected public functionality if integrity is uncertain;
- rotate exposed credentials;
- restore from an approved backup only when needed.

A public-site incident does not automatically invalidate local assessment evidence unless the affected infrastructure participated in that evidence chain.

## Database recovery

Where PostgreSQL is used for the deployed website:

- prefer the hosting provider's supported recovery capability;
- use repository backup/restore scripts only with an approved destination and maintenance window;
- never overwrite a live database casually;
- verify restored data before reopening affected functionality.

## Shutdown and maintenance

Use normal process termination and allow the server to close connections cleanly.

Do not treat deployment status as an assessment readiness decision.

## Commercial operations

The active commercial flow is request -> scope -> quote/agreement -> assessment.

There is no active self-service Stripe checkout/subscription workflow in the current model.
