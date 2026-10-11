# KB-029 — Shared human or workload identities destroy accountability

**Status:** candidate technical test design for accountable human review. This is not a finding about the frozen MCP target, not proof that its users share accounts, and not approval of deployment.

## Failure and authority boundary

Multiple people, automation workers or agents may act using one generic privileged identity, shared API credential, reusable approval account or reused service principal. Audit records can then appear complete while failing to establish **which accountable actor** authorized or executed each consequential operation. A stable display name, originating IP address, prompted self-report of identity or shared system token alone does not prove attribution.

Distinguish a non-human workload identity tied to an accountable service owner from a human account and any delegated end-user context. Record handoffs and impersonation/delegation separately; never infer a unique human merely from a service principal. Break-glass exception credentials require time-bounded policy, individual attributable access, special logging and retrospective accountable review.

## Seven proposed evidence families — future candidate migration 052

1. **Exact assessed scope**: frozen commit/deployment version and environment; privileged accounts, service principals, agent/tool callers, delegated user identities, approval, change and evidence-signing actions, audit sinks and identity providers within scope.
2. **Approved accountability policy**: current organisation-approved inventory linking each named human, workload, owner, role, permitted delegation and exceptional break-glass arrangement to accountable identity records; policy version, effective dates and reviewer.
3. **Source and configuration**: access/session identity binding, shared credential prevention, workload identity issuer and audience, session and delegation traces, approval attribution, audit integrity and fail-closed missing/ambiguous principal behavior. Static hints do not prove real people do not share a credential.
4. **Positive synthetic evidence**: distinct authorized user and workload principals perform representative approved actions; attribution spans the authenticated actor, delegated subject, tool caller, approval and downstream operation without conflating identities.
5. **Negative synthetic evidence**: generic/shared privileged identity, swapped actor or subject, missing principal, unauthorized delegation, self-approval conflicts, reused approval token and unapproved break-glass variant. Require denial or controlled quarantine **before material effects** when prohibited by approved policy, with trustworthy audit linkage.
6. **Observed runtime attribution**: correlated authentication and identity provider events, actor/workload IDs, delegation chain and reviewer role, policy digest, decision, action/effect and tamper-evident audit records. A field labelled 'user' is not independent proof of who acted.
7. **Accountable human review**: written authorization for synthetic test scenarios, review of unique-principal inventory and permitted service/break-glass exceptions, exact build/digest, tester and reviewer identity/roles, untested paths, limitations and signed assessment decision.

## Outcome boundary

- **Confirmed FAIL** only when attributable, exact-version test evidence demonstrates accepted unauthenticated/generic authority, prohibited shared privileged credential use, unauthorized delegation/approval, or consequential action without the required independent actor provenance.
- **INCONCLUSIVE / EVIDENCE GAP / REVIEW REQUIRED** where identity inventory, independent actor mapping, approved exception policy, active test authorization, runtime correlation or human review is missing or incomplete. Missing evidence is not itself proof of a shared account or exploit, but cannot justify PASS or deployment.
- **PASS candidate** only after bounded positive and negative paths are observed, approved exception rules are evidenced, audit linkage is independently reviewable, identity ownership is attributable and an authorized human concludes. Do not claim that untested accounts or endpoints are safe.

## Safe target and test restrictions

Preserve the exact frozen `arl-target-mcp-agent` SHA `b3116fcfcec3bf6967773c3e9587c502b1fed5e5` for passive, read-only review only. Use no real personal accounts, real tokens, customer credentials or unapproved external authentication calls. Active tests require separate owner-written RoE and synthetic staging principals, events and reversible/dry-run effects. Do not test actual break-glass accounts or alter customers' access.

This specification precedes additive candidate migration 052 and signed JSON, CSV, public and generated SQL updates. Earlier migrations and all other control digests must be retained; exact-head CI and accountable semantic review remain mandatory.
