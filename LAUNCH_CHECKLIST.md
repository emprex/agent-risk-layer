# AgentRiskLayer v9 controlled-beta launch checklist

## Infrastructure

- [ ] GitHub repository contains the v9.0.0 package at root
- [ ] Render Blueprint provisions paid web plus managed PostgreSQL
- [ ] Web service has no persistent disk and no production `DATABASE_PATH`
- [ ] `/api/health` and `/api/ready` return 200
- [ ] `/metrics` is reachable only with the configured bearer token
- [ ] Custom domain, HTTPS and security headers are active

## Security control plane

- [ ] Community project and one-time key issuance tested
- [ ] Production project defaults to enforce mode
- [ ] Guard allow, deny, replay, quota and revoked-key cases tested
- [ ] High-impact action fails closed without transaction-bound approval
- [ ] Raw prompts, responses and tool arguments are absent from stored runtime evidence
- [ ] Inventory baseline and risky drift gate tested
- [ ] Remediation assignment and verification tested
- [ ] Key/policy/inventory/remediation audit history reviewed

## Identity and tenancy

- [ ] Strong `SESSION_SECRET` and `METRICS_TOKEN` generated in Render
- [ ] Legal entity, address, jurisdiction, support and owner email are factual
- [ ] Registration requires one of 20 controlled-beta invitations
- [ ] Email verification, MFA, recovery codes and password reset tested
- [ ] Cross-workspace access, billing-owner limits and SCIM deprovisioning tested

## Payments and email

- [ ] Free, £99, £29, £99, £249 and Enterprise pricing claims reviewed
- [ ] Stripe Managed Payments checkout and signed webhook tested in sandbox
- [ ] Resend domain and sender verified
- [ ] Paid report, subscription, billing portal, cancellation and retry journeys tested

## Data and recovery

- [ ] Three PostgreSQL migrations applied with matching checksums
- [ ] PostgreSQL backup created and independently verified
- [ ] Restore drill completed against non-production PostgreSQL
- [ ] Runtime/project retention purge and legal hold tested
- [ ] Export and account deletion reconcile project/workspace records

## Customer journey

- [ ] Desktop and mobile registration, control plane, assessment, checkout and dashboard tested
- [ ] Inspector and red-team evidence upload/replay protection tested
- [ ] PDF, email, sharing, export and deletion tested
- [ ] Security Centre, comparison and pricing statements match executable scope

## External assurance

- [ ] Legal review completed before unrestricted public sales
- [ ] Independent penetration test scheduled or completed
- [ ] Internal results are not described as certification, guaranteed detection or production history
