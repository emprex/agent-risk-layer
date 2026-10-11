# KB-028 — Revoked users and stale roles retain authority

**Status:** candidate canonical-control design for accountable review. Not a customer finding, not proof the frozen MCP target is vulnerable or compliant.

## Failure mode and trust boundary

A user removed from a workspace, stripped of an elevated role, or deactivated may retain derived authority through signed sessions, API keys, approval records, delegated tool privileges, cached ACLs, long-running jobs, retry queues, scheduled tasks, async callbacks and downstream service tokens. Security requires **current authorization at the enforcement point immediately before a meaningful side effect**, not merely the presence of a previously issued token or an LLM assertion. A session's successful authentication must never itself grant a stale role.

A provider may offer bounded revocation propagation or short-lived credentials. Record the actual permitted grace period, expiry time and documented compensating controls; do not silently assume revocation is instantaneous or a timing difference is a confirmed exploitable failure.

## Seven required evidence families for candidate migration 051

1. **Exact assessed scope:** frozen build and deployed configuration identity, environment, role/tenant/workspace boundaries, relevant user and service identities, sessions, delegated tokens, API keys, approvals, caches, memory, jobs, queues, scheduled actions and downstream tools.
2. **Human-approved revocation policy:** owner-approved role and membership matrix, deprovisioning triggers, propagation service boundaries, acceptable revocation latency and exception policy, token expiry/session invalidation, queued-work cancellation or reauthorization and accountable owner.
3. **Source and configuration:** version-specific session/role checks, cache invalidation/TTL, key and token revocation, worker state checks, approval invalidation, retries and asynchronous authorization gates at the receiving service. A file name, library or policy declaration does not prove enforcement.
4. **Positive bounded tests:** separately authorized synthetic users exercise approved current-role, current-workspace, and still-permitted low-privilege actions; verify expected responses and effects before/after change.
5. **Negative bounded tests:** remove membership, demote role, disable account, revoke a key/session or withdraw an approval; replay previous sessions, cached role, delegated tool authorization, pending jobs, retries and stale approval. Verify no forbidden data, metadata or side effects *after the documented policy-bound cutoff*; explicitly record the latency measured.
6. **Correlated runtime evidence:** revocation event ID, timestamp, policy version, propagation acknowledgement or bound, identity/role/tenant at receiver, decision and denial reason, runtime traces across sessions, API/tool calls, queued tasks and downstream side effects. A 401 response alone is insufficient if work still executes elsewhere.
7. **Accountable review:** written test authorization, synthetic identity scope, tester/reviewer role, timestamp, exact deployed version and evidence digest, limitations, grace periods, unsupported surfaces and explicit human decision.

## Outcome boundary

- **Confirmed FAIL** only where exact-version corroborated evidence shows an unauthorized action, disclosure or state change after the allowed revocation cutoff, or an implementation demonstrably accepts an invalidated authorization context.
- **INCONCLUSIVE / EVIDENCE GAP / REVIEW REQUIRED** when the revocation design, effective time, propagation, downstream traces, testing authority, bounded runtime observations or accountable signoff is missing. Do not invent an exploit from a missing record. No PASS or deployment approval.
- A **PASS candidate** requires exact-version, applicable-path positive and negative evidence, measured and policy-consistent revocation behavior, no unauthorized downstream effects, and an attributable human review. No extrapolation to untested paths.

## Safe pilot and change boundary

Frozen pilot reference `arl-target-mcp-agent` SHA `b3116fcfcec3bf6967773c3e9587c502b1fed5e5` is **read-only**. Active testing, service calls, revocation events and impersonation require separately written owner-authorized RoE and synthetic staging identities and data. Never revoke or test real customer accounts, production credentials or third-party services.

This design is intended for an **additive** next semantic migration 051, with synchronized signed JSON, CSV, derived SQL and public JSON, no edits to older migrations, exactly 107 unaffected canonical digests, exact-head unit/PostgreSQL CI and accountable human semantic review. Target deployment HOLD remains unchanged.
