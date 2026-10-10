# AgentRiskLayer launch checklist

## Canonical product

- [ ] `emprex/agent-risk-layer` is the only canonical ARL repository.
- [ ] `main` is the intended reviewed release revision.
- [ ] CI is green on the exact release head.
- [ ] `npm run check`, `npm test` and required smoke/acceptance checks pass.
- [ ] No retired hosted-operator dependency is required for local assessment.
- [ ] Local assessment freezes the exact clean target revision.

## Public website

- [ ] Homepage clearly presents a human-led AI-agent security assessment.
- [ ] Assessment page reflects the current service.
- [ ] Request form submits successfully.
- [ ] No password, API key, token or production secret is requested through the public form.
- [ ] Scope-and-quote wording is consistent.
- [ ] No active checkout/subscription claim remains.
- [ ] Privacy, terms, company, trust and complaints/appeals pages are reachable.
- [ ] No page claims UKAS accreditation unless actually granted.

## Assessment workflow

- [ ] Request -> scope -> frozen target works.
- [ ] Inspection/evidence is bound to the exact revision.
- [ ] Applicability requires authoritative evidence/human review as defined by the method.
- [ ] Controlled tests require explicit authorisation and Rules of Engagement.
- [ ] Findings cannot be created or closed by LLM authority.
- [ ] Remediation preserves finding/snapshot lineage.
- [ ] Exact retest is required for closure where applicable.
- [ ] Final readiness/deployment decision remains attributable to a human.
- [ ] Final report states evidence, limitations and unresolved items clearly.
- [ ] Exported customer report Markdown, JSON and manifest pass local `npm run report:verify` content-consistency check; manifest hash is not a signature or approval.

## Operational boundary

- [ ] Render hosts only the static public site: no ARL application server, ARL database or hosted Operator.
- [ ] Static request-intake delivery is verified using the actual configured destination, without assuming a hosted ARL API.
- [ ] Local Operator assessment uses PostgreSQL via DATABASE_URL; SQLite remains test-only.
- [ ] Public-site deployment is operationally separate from local assessment authority.
- [ ] Local assessment remains usable when the hosted website is unavailable.
- [ ] Deployed secrets exist only in the deployment environment.
- [ ] Backup/recovery procedures are verified for any deployed persistence in use.

## Commercial readiness

- [ ] Assessment request can be received and reviewed.
- [ ] Scope and authorised test boundary can be agreed before work begins.
- [ ] Commercial terms can be issued without a retired self-service checkout dependency.
- [ ] Sample report accurately represents the current deliverable.
