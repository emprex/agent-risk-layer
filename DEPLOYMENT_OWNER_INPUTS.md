# Deployment owner inputs

This file lists owner-controlled inputs for the current public website/request deployment.

## Repository and deployment

- Canonical repository: `emprex/agent-risk-layer`
- Deploy only reviewed `main` commits with green CI.
- Keep local assessment execution independent from the hosted website.

## Render

If Render remains the selected host:

- maintain the Render account and billing required for the public web service;
- connect the canonical GitHub repository;
- review `render.yaml` before deployment;
- configure the required environment variables and managed PostgreSQL connection;
- verify custom-domain DNS and TLS.

## Email

If assessment-request notifications use Resend:

- maintain the verified sender domain;
- configure `RESEND_API_KEY` and `EMAIL_FROM`;
- verify delivery and failure handling;
- never include secrets or customer credentials in automated email content.

## Legal and company data

Keep the following factual and current:

- company legal name;
- support email;
- jurisdiction;
- privacy and terms pages;
- public claims about accreditation/certification status.

ARL must not claim UKAS accreditation unless it has actually been granted for the relevant scope.

## Retired commercial inputs

Stripe checkout, subscription prices and billing-portal configuration are not part of the current assessment service model and must not be reintroduced accidentally.

Commercial terms are agreed directly after scope review.
