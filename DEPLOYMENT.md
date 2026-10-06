# AgentRiskLayer deployment

This document covers deployment of the public AgentRiskLayer website and assessment-request service.

It does **not** define the authority for customer assessments. Assessment execution remains local and operator-led from the canonical repository.

## Public service boundary

The deployed web service may provide:

- the public marketing site;
- trust, research and methodology pages;
- assessment-request intake;
- supporting authenticated product surfaces that are intentionally retained;
- health/readiness endpoints and operational telemetry.

The deployed web service is not a remote security authority for local assessments.

## Repository

Canonical repository:

```text
emprex/agent-risk-layer
```

Before deployment:

1. confirm the intended Git commit;
2. require CI success;
3. review the diff;
4. verify no secrets are committed;
5. verify the public request flow and legal pages;
6. verify the deployment configuration matches the current service model.

## Render

The current repository still contains `render.yaml` for the public web service.

If Render is used:

- connect only the canonical repository;
- deploy the intended `main` revision;
- configure secrets in Render, not in Git;
- use the configured PostgreSQL service where the web application requires persistence;
- do not make local assessment execution depend on Render availability.

## Configuration

Use `.env.example` only as a reference.

Typical deployed-service settings include:

```text
DATABASE_URL
SESSION_SECRET
BASE_URL
METRICS_TOKEN
RESEND_API_KEY
EMAIL_FROM
ADMIN_EMAIL
SUPPORT_EMAIL
COMPANY_LEGAL_NAME
LEGAL_JURISDICTION
```

Only configure values actually required by the active deployment. Do not restore retired payment/subscription settings.

## Pre-deployment checks

Run:

```bash
npm ci
npm run check
npm test
npm run smoke
```

Then verify:

- homepage and assessment pages render correctly;
- `/request-assessment.html` submits successfully;
- no secret or credential is requested from prospects;
- legal/privacy pages are reachable;
- trust and accreditation wording remains bounded;
- `/api/health` and `/api/ready` behave as expected for the deployed environment.

## Assessment execution boundary

Customer assessment work is performed locally from the canonical repository.

The normal assessment path is:

request
-> scope
-> frozen target
-> inspection/evidence
-> applicability
-> authorised controlled tests
-> findings
-> remediation
-> exact retest
-> report
-> human final decision

A website deployment must never become a prerequisite for that authority chain.

## Recovery

Database backup/restore procedures apply only to deployed web-service data that actually uses the configured database.

Never infer customer assessment closure or readiness from infrastructure recovery state.
