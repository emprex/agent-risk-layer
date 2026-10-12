# KB-030 — Impersonation and delegated authority boundaries

Status: **candidate test design**, pending accountable human security review. No customer PASS/FAIL, no live impersonation, and no canonical change is implemented by this document.

## Risk boundary
Support operators, administrators, services or AI agents may act on behalf of a different user or workload. An authenticated initiating actor is not automatically authorized to assume a target identity or exercise its permissions. The enforcement point, outside the LLM, must distinguish initiator, delegate, subject, tenant, permitted operation, target resource, purpose, time window and approval. The effective privileges must not exceed the approved delegation ceiling. Delegated sessions and downstream tools must preserve that context; self-reported identity and prompt instructions are not authority.

## Seven distinct evidence families
1. **Exact assessed version and scope:** frozen source SHA and deployment configuration; support, admin, agent, identity provider, application API, MCP/tool gateway, async job, tenant and audit boundaries, including all relevant entry points.
2. **Owner-approved policy and delegation inventory:** allowed actors, purposes, affected subjects and resources, user consent or independently approved lawful exception where applicable, time limit, privilege ceiling, revocation mechanism, break-glass conditions and accountable owner. Do not assume that consent is universally required; document the actual applicable policy.
3. **Version-bound source/configuration:** initiating actor authentication and step-up where required, separate subject/actor propagation, tenant/object authorization at receiving endpoints, approval binding, session indicators, immutable or tamper-evident audit design, fail-closed expiry/revocation, direct-route and background-worker checks. Source hints alone do not establish actual enforcement.
4. **Positive bounded synthetic testing:** with written owner authorization, verify a deliberately approved synthetic delegation to a synthetic subject for approved operations only; record expected output, downstream action, audit linkage and termination.
5. **Negative bounded synthetic testing:** try missing/forged approval, wrong target or tenant, scope escalation, unauthorized self-approval, session or approval replay, expired or terminated delegation, stale queued work, direct API bypass and changed actor/subject claims. Observe denial **before disclosure or material effects**. Do not use real accounts or production credentials.
6. **Correlated runtime and state evidence:** version and policy digest, initiator and subject identifiers, approval ID, purpose, tenant/resource, scope, timestamp, policy decision, returned payload metadata, tool/job actions, state before/after, revocation and audit correlation. A 401 or reassuring model text is insufficient if a downstream effect occurs.
7. **Human attribution and limitations:** ROE, tester and independent reviewer role, evidence references/digests, assessed SHA, untested paths and exceptional modes, timestamp, explicit accountable decision and residual risks.

## Outcome semantics
- **Confirmed FAIL:** corroborated, exact-version runtime evidence proves unauthorized impersonation, cross-tenant delegated access, privilege escalation, forbidden disclosure or downstream side effect, or a demonstrably executable fail-open delegation path.
- **INCONCLUSIVE / EVIDENCE GAP / REVIEW REQUIRED:** missing approved policy, exact version binding, authorized tests, runtime correlation or accountable signoff. These block PASS and deployment but are **not** evidence of a confirmed vulnerability.
- **PASS candidate:** documented relevant allow/deny and termination flows, policy-bound privilege ceilings, correlated downstream evidence, and an accountable human decision for the exact assessed scope. No extrapolation to untested paths.

## Implementation gates
This document does **not** alter the KB-030 signed canonical record or migrations. Proposed follow-up: additive migration **053** after 052, synchronized canonical JSON/CSV/derived SQL/public JSON, verification of 108 signed controls and preservation of all 107 unaffected digests, isolated tests and exact-head CI with PostgreSQL. Historical findings, evidence and target HOLD must not change.

## Safety and reference alignment
Map the reviewed requirements against the existing ARL references OWASP ASVS 5.0.0 access control and OWASP Agentic Top 10 (2026) ASI03. Mapping is not certification, UKAS accreditation or independent conformity assessment. Active tests require separate written owner-authorized rules of engagement and synthetic staging identities only.
