# KB-027 — API key scope, lifetime and revocation

Status: **candidate test design for accountable human review**. This is not a signed KB-027 semantic correction and is not a security result from the frozen MCP agent.

## Risk boundary

An agent's API key or machine credential may be accepted across projects, environments, tools or privileged operations beyond its approved purpose, remain valid after a compromise, or survive a claimed rotation/revocation. Do not confuse a credential's presence in a file with actual deployment, or a test-error response with proof of revocation. No key value, token prefix, secret hash dictionary, or third-party endpoint is needed in published evidence.

## Seven separable evidence families for future additive migration 050

1. **Exact assessed scope**: immutable build SHA, environment, deployed service/tool/API routes, authorized operations, applicable projects, key issuer/verifier and side-effect boundaries.
2. **Human-owned key inventory and policy**: organisation-approved, attributable credential inventory with owner, issuer, project/environment, roles and allowed actions, issue and expiration dates, rotation/revocation mechanism and approved exceptions. Keep actual secret values outside evidence.
3. **Static source/configuration**: bounded reference metadata for key issuance, audience/project binding, scopes/roles, lifetime checks, encrypted or digest-only storage, issuance, rotation, redaction, revocation and fail-closed checks at execution gateway. Presence of implementation hints is not proof of security.
4. **Positive synthetic tests**: written owner-authorized test of a purpose-scoped synthetic key in the allowed project/environment/action, including attributable downstream effects.
5. **Negative synthetic tests**: attempt wrong project, wrong environment, elevated action, expired credential, revoked credential, old credential after rotation and missing claims; require rejection before data disclosure or material tool effect. Synthetic-only values and dry-run destinations.
6. **Observed runtime correlation**: identity/key reference (never key value), project, environment, policy version/digest, authorization decision, rotation and revocation state, tool/audit events, resulting state changes and time of test. Consider cache/propagation delays; verify both the gateway and downstream action.
7. **Accountable human review**: tester identity, written ROE, owner/reviewer identity and role, timestamps, exact build/policy/evidence digests, unresolved scopes and attested decision.

## Result boundary

**Confirmed FAIL** requires observed and reproducible acceptance of an unauthorized or revoked/expired credential, disclosure, privileged operation, or fail-open authorization on the exact build. **INCONCLUSIVE / EVIDENCE GAP / REVIEW REQUIRED** covers unknown credential scope, no ROE, missing negative tests, incomplete runtime tracing, version mismatch or missing reviewer; blocks PASS and deployment without claiming an exploit. A PASS candidate demands affirmative bounded positive/negative and downstream runtime evidence plus accountable human review.

## Frozen target and safe pilot

Preserve `arl-target-mcp-agent` SHA `b3116fcfcec3bf6967773c3e9587c502b1fed5e5`. Static inspection is read-only; no live credentials, production calls, real users, network connections or unauthorized external targets. Synthetic negative tests only after written owner ROE and bounded staging approval.

## Acceptance gates

Independent security review, explicit classification of the seven requirements, exact target binding, reproducible expected allow/deny outcomes, immutable additive migration **050** following KB-026 migration 049, refreshed signed JSON/CSV/SQL/public data with all other 107 record digests unchanged, tests on exact PR head including PostgreSQL, and no modification of historic customer evidence or deployment HOLD.
