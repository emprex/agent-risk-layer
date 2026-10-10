# KB-025 — Tenant isolation across retrieval and agent tool boundaries

Tracking issue: #347. **Design proposal**, not a customer assessment or evidence of an attack.

## Failure mode
A tenant-scoped web application may appear isolated while downstream retrieval, vector indexes, memory, caches, background jobs, tool actions, generated outputs, exports or logs omit or overwrite tenant identity. Authorization must be applied to every data access and action outside the model; a prompt instruction to respect tenant boundaries is not an enforcement point.

## Evidence requirements for a future semantic migration

1. **Exact version and scope**: build revision, environment, synthetic tenants A/B, authenticated actors/service identities, scoped data collections, memory, cache partitions, job queues, tools, exports and downstream sinks.
2. **Human-approved isolation policy**: tenant/object/operation matrix, identity propagation and authorized sharing exceptions, approved by the accountable data/security owner.
3. **Static enforcement**: version-specific code/configuration evidence for mandatory tenant filters, namespace boundaries, cache keys, tool auth contexts, async job identity propagation, exports/logging segregation and fail-closed missing-claim paths.
4. **Positive tests**: bounded owner-authorized tests showing each synthetic tenant obtains only approved retrieval, tool responses and state changes through all applicable paths.
5. **Negative tests**: bounded cross-tenant probes for direct ID/list/search, vector retrieval, embedded/reranked context, memory, caches, background jobs, tool calls, indirect identifiers, exports/logs, omitted claims and replay; no foreign metadata, response payload or side effect.
6. **Runtime evidence**: correlated identity/tenant context, query filters/namespace, retrieved record provenance, tool authorization, responses, state deltas and audit records, including deny decisions. A returned error code alone cannot prove absence of a leak.
7. **Human attribution**: documented authorization, tester and reviewer roles, timestamp, exact build and digest, untested paths, residual limitations and accountable decision.

## Pass/fail boundary
**Candidate PASS only after human review** when scoped same-tenant paths work and all tested cross-tenant variants fail closed before disclosure or side effects, backed by attributable runtime evidence. **FAIL/review** on any cross-tenant access, metadata leakage, inconsistent tenant context, missing negative evidence or mismatched version. The result cannot certify untested paths.

## Implementation boundary
Add a new numbered additive migration after 047 without touching historical migrations or assessments. Protect all other 107 knowledge digests. Update canonical JSON/CSV, derived SQL/public data and 7-clause classification regression together. Require exact-head CI and separate owner authorization for any active target tests. Preserve target HOLD; no finding closure or deployment permission.
