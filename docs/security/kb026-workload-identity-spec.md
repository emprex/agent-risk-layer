# KB-026 — Service-to-service identity and authorization boundaries

Status: **candidate technical test design** for accountable human review. This is not a signed canonical change, customer result, or assertion that the frozen MCP target fails/passes.

## Risk and enforcement point

The assessed agent may call orchestrators, model gateways, MCP/tool gateways, vector databases, job workers or evidence services. Internal network location, a shared bearer secret, an LLM-generated authorization claim, or a successful TLS connection must **not** substitute for verifiable service identity and authorization. Every relevant hop must bind **workload identity, intended audience, allowed operation, target and context** at the receiving service, before any data disclosure or side effect. Where appropriate, use mutually authenticated channels, short-lived and revocable credentials, and deny-by-default policy. Do not confuse workload-identity authentication with application-user or tenant authorization: both may be required.

## Seven evidence families — proposed for future signed migration 049

1. **Exact target and hop scope**: frozen build SHA, deployment/environment, component map, in/out boundaries, routes and reachable tool/service actions.
2. **Accountable declared identity policy**: approved service-identity inventory, role-to-service and audience matrix, credential issuance/expiration/revocation and explicit exceptions, owner, effective date and revision.
3. **Source and configuration observations**: receiving-side identity validation, required issuer/audience, scope/role checks, mTLS or equivalent where applicable, fail-closed missing identity, forwarded identity and credential isolation for background jobs, replay protection, evidence of policy distribution and configuration drift. File names alone are not proof that these checks execute.
4. **Positive bounded owner-authorized tests**: per permitted service identity and operation, synthetic-only data, valid audience/claims and expected output/side-effect recorded on the frozen build.
5. **Negative bounded owner-authorized tests**: missing identity, wrong/forged issuer or audience, retired or expired credential, wrong-service identity, altered delegated user/tenant context, cross-tool confused deputy, replay, direct bypass and job-worker identity propagation. Require **denial before any relevant effect**, with no foreign data/metadata.
6. **Correlated runtime evidence**: source workload, subject, issuer, audience, policy/digest, authorized action and resources, decision and denial reason, upstream/downstream correlation, data/result provenance and side effects, with security-safe/redacted logs. An HTTP 401 or a reassuring prompt alone is insufficient.
7. **Accountable human conclusion**: ROE authorization and scope for tests, tester/reviewer identities and roles, exact version/digest, unresolved paths, residual limitations and signed decision.

## Result authority

- **Observed FAIL**: reproducible and corroborated unauthorized service access, forged/replayed identity accepted, wrong-audience use, unauthorized data disclosure or downstream side effect on the exact version.
- **INCONCLUSIVE / EVIDENCE GAP / REVIEW REQUIRED**: missing inspection, no authorization for active tests, absent positive/negative/runtime proof, unresolved identity propagation or missing human signoff. These **block PASS and deployment**, but are not fabricated vulnerabilities.
- **PASS candidate** only after identity controls demonstrably hold on every applicable scoped hop, positive and negative tests pass, runtime evidence is attributable and an authorized human concludes. No claim over untested paths.

## Safe MCP pilot boundary

Use only an exact frozen **`arl-target-mcp-agent`** SHA `b3116fcfcec3bf6967773c3e9587c502b1fed5e5` for passive read-only inspection. Do not modify this target. No live service calls, real credentials, unsanctioned external hosts or cross-tenant actions. Future negative scenarios require explicit written owner-authorized ROE and synthetic identities/data. Source evidence alone cannot establish exploitability or legal obligations.

## Acceptance before signed canonical correction

Independent review of the seven family taxonomy, exact version and human authority, correct machine/runtime/human classification, reproducible test scenarios with expected observations, complete migration 049 and generated signed artifacts, 107 other content digests unchanged, exact-head CI with PostgreSQL, and no retroactive change to evidence or deployment HOLD. Keep this as a draft until reviewed.
