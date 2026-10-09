# KB-024 — Object-level authorization semantic correction proposal

Issue: #345. Status: implementation specification; **not** customer evidence, an assessment result, or deployment approval.

## Security objective
Prove, for the **exact version and authorized staging scope**, that every object read, modification, export and deletion is checked server-side against the authenticated actor, tenant/workspace, object ownership and permitted operation. A guessed identifier or alternative endpoint must not bypass enforcement. Responding with HTTP 403 alone does not establish absence of data exposure or side effects.

## Seven proposed canonical evidence clauses
1. **Scope and provenance** — assessed system, version/build digest, environment, tenant/workspace, object classes, protected operations, and synthetic actor identities.
2. **Human-approved policy** — versioned object-authorization matrix (actor/role × tenant × object ownership × operation), accountable owner and explicitly permitted exceptions.
3. **Static enforcement** — server-side source/configuration locations for object-scoped query guards, authorization checks, alternate endpoints/service methods and deny-by-default policy paths; static inspection is not runtime validation.
4. **Authorized positive behavior** — bounded, owner-authorized staging tests demonstrating permitted same-tenant accesses with expected/observed outputs and object state.
5. **Denied negative behavior** — bounded staging tests demonstrating denied cross-user, cross-tenant, object-ID swap, indirect reference, alternate route/method, missing-policy and service-identity combinations **before any leak, mutation, export or other side effect**.
6. **Observed runtime and audit evidence** — correlated allow/deny decisions, response/output checks, object state before/after, relevant downstream audit events and limitations. Never infer the authorization decision from status codes alone.
7. **Human attribution** — named tester and reviewer, roles, timestamps, exact version, evidence digests, exceptions, residual risk and recorded human decision.

## Acceptance boundary
**Pass only by accountable human decision** when all seven clauses are supported for the same exact scoped version, permitted operations work, forbidden operations fail closed before exposure or side effects, logs and state observations corroborate the tests, and limitations are reviewed.

**Fail or require review** if any unauthorized object operation succeeds, a partial data leak occurs, guards rely on caller-supplied tenancy/ownership, enforcement is UI-only, alternate paths bypass it, required tests lack authorization, evidence is stale/mismatched, or attribution and human review are missing.

## Retest criteria
- Record changed authorization code/policy, role-object matrix, deployed version and digests.
- Repeat positive and negative tests with approved synthetic identities and known initial/final object state.
- Correlate denial with authorization/audit telemetry and prove no unauthorized response payload, export or mutation.
- Document residual exceptions, reviewer identity, limitations and exact-retest decision.

## Required implementation (not performed by this specification)
- Edit canonical JSON and CSV together without changing historical evidence.
- Append migration **047** only after checking existing migration numbering and bootstrap inclusion.
- Recalculate signed content digests using the repository's existing canonical builder (never hand-invent hashes).
- Add semantic regression tests for all seven clauses and classification boundaries.
- Verify exact-head CI before merge; leave assessed-target verdict and deployment **HOLD** untouched.
- Tests involving a live or staging target need a separate written owner authorization; no real credentials by default.
