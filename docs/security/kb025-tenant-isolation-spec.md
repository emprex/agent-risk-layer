# KB-025 — Tenant isolation across retrieval and agent tool boundaries

Tracking issue: #347. **Candidate semantic implementation for human review**, not a customer assessment or evidence of an attack.

## Failure mode
A tenant-scoped web application may appear isolated while downstream retrieval, vector indexes, memory, caches, background jobs, tool actions, generated outputs, exports or logs omit or overwrite tenant identity. Authorization must be applied to every data access and action outside the model; a prompt instruction to respect tenant boundaries is not an enforcement point.

## Required evidence for migration 048

1. **Exact version and scope**: build revision, environment, synthetic tenants A/B, authenticated actors/service identities, scoped data collections, memory, cache partitions, job queues, tools, exports and downstream sinks.
2. **Human-approved isolation policy**: tenant/object/operation matrix, identity propagation and authorized sharing exceptions, approved by the accountable data/security owner.
3. **Static enforcement**: version-specific code/configuration evidence for mandatory tenant filters, namespace boundaries, cache keys, tool auth contexts, async job identity propagation, exports/logging segregation and fail-closed missing-claim paths.
4. **Positive tests**: bounded owner-authorized tests showing each synthetic tenant obtains only approved retrieval, tool responses and state changes through all applicable paths.
5. **Negative tests**: bounded cross-tenant probes for direct ID/list/search, vector retrieval, embedded/reranked context, memory, caches, background jobs, tool calls, indirect identifiers, exports/logs, omitted claims and replay; no foreign metadata, response payload or side effect.
6. **Runtime evidence**: correlated identity/tenant context, query filters/namespace, retrieved record provenance, tool authorization, responses, state deltas and audit records, including deny decisions. A returned error code alone cannot prove absence of a leak.
7. **Human attribution**: documented authorization, tester and reviewer roles, timestamp, exact build and digest, untested paths, residual limitations and accountable decision.

## Pass/fail boundary
**Candidate PASS only after accountable human review** when scoped same-tenant paths work and all tested cross-tenant variants fail closed before disclosure or side effects, backed by attributable runtime evidence. **Observed FAIL** requires corroborated exact-version disclosure, unauthorized execution or a demonstrably fail-open tenant boundary. **INCONCLUSIVE / EVIDENCE GAP / REVIEW REQUIRED** applies when negative tests, runtime observations, assessed-version binding or accountable review are missing; this blocks PASS and deployment without inventing a confirmed vulnerability. No result certifies untested paths.

## Implementation and acceptance boundary
Migration 048, canonical JSON/CSV, derived SQL/public data and seven-clause regression are included in this PR. All other 107 signed control digests remain unchanged. Exact-head CI and accountable semantic review are required before merge. Active target tests still require separate written owner authorization. Preserve target HOLD; no finding closure or deployment permission.
