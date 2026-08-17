# AgentRiskLayer production hardening audit — 2026-08-17

## Assessment identity

- Repository: `emprex/agent-risk-layer`
- Baseline: `b239b95386f4474a76b0d830d3b1aaab6fe4c4cb`
- Audit branch: `audit/production-hardening-20260817`
- Product version declared in code: `10.1.1`
- Control profile in customer-facing evidence UI: `ARL-RKA-1.2.0`
- Assessment type: proprietary code/security review and remediation. This is not an accredited certification and is not a guarantee that the system is risk-free.

## Scope reviewed

The review prioritised production trust boundaries and customer-critical paths: configuration/readiness, HTTP security and CSRF, authentication/session/MFA/reset/verification flows, roles and tenant/workspace membership, SCIM, outbound integrations, email delivery, Control Intelligence scope suggestions, model provenance and model artifact analysis. Existing billing, Stripe webhook, runtime-policy, approval, red-team, retention, deletion, database adapter and server-route code was inspected for interaction with these changes.

The review was performed against repository source obtained from GitHub. The normal Debian checkout and production database were not available in this execution environment, so full repository tests, PostgreSQL integration tests and live production verification remain required before a deployment claim.

## Evidence principles preserved

- Runtime completion is not a deployment decision.
- Architecture matching is decision support, not a finding and not confirmed applicability.
- Unknown or inconclusive information is not converted into a vulnerability.
- Historical assessment evidence is not rewritten by later runtime evidence.
- High-impact approval semantics remain bound to the exact action/context implemented by the existing Control Plane.

## Corrected high-confidence defects

### Control-scope suggestion confidence

**Observed:** the previous server suggestion profile could mark a control `suggested` after a single broad metadata match. A later UI layer attempted to repair this by parsing rendered fact text, creating duplicated semantics and a regex-classification error risk.

**Remediation:** `ARL-SUGGEST-1.1.0` now calculates conservative confidence server-side. A prepared applicability suggestion requires at least two triggering snapshot facts and at least one risk-bearing fact. The UI consumes the server classification and does not derive confidence independently. All applicability choices still require explicit confirmation.

**Retest evidence added:** `tests/control-suggestions.test.js`, `tests/control-intelligence-scope-review-v2.test.js`.

### Production CSRF origin trust

**Observed:** production origin verification included a request-derived Host origin alongside the configured canonical origin.

**Remediation:** production accepts the canonical configured `BASE_URL` origin only. Request-derived origin allowance is limited to non-production environments. Existing double-submit token and SameSite controls are preserved.

**Retest evidence added:** `tests/csrf-origin.test.js`.

### Authentication single-use token and MFA races

**Observed:** reset, email verification, MFA challenge and recovery-code flows contained read-then-write windows that could permit concurrent consumers to race.

**Remediation:** database transactions/row locks or compare-and-swap updates now protect reset-token consumption, email verification consumption, MFA login attempts/completion, recovery-code consumption, password changes and MFA enable/disable transitions.

**Retest evidence added:** `tests/auth-concurrency.test.js` for concurrent reset and verification consumption. Full PostgreSQL concurrency testing remains required.

### Workspace/SCIM owner integrity and identity conflicts

**Observed:** SCIM could demote the last active owner, and simultaneous owner changes could race. SCIM external ID and email resolution could also ambiguously match different members.

**Remediation:** membership mutations serialize on the workspace row; last-owner checks run under that lock; external ID/email conflicts are rejected; SCIM email validation is shared with normal membership validation.

**Retest evidence added:** `tests/workspaces.test.js`.

### Outbound integration and transactional-email availability

**Observed:** outbound integration delivery and Resend email delivery did not have bounded request timeouts. Integration URLs also accepted embedded credentials.

**Remediation:** ten-second abort timeouts and redirect blocking were added. Integration endpoints reject embedded credentials.

**Limitation:** generic integration destinations remain an SSRF trust boundary. A complete DNS/IP destination policy must be designed around actual enterprise integration requirements rather than assuming that all private destinations are invalid.

### Model provenance validation

**Observed:** model source validation relied on a string prefix and model manifest evidence hashing depended on object key order.

**Remediation:** source URLs must parse as credential-free HTTPS URLs with a hostname; manifest evidence uses canonical sorted JSON before hashing.

**Retest evidence added:** `tests/model-security.test.js`.

### SafeTensors range validation

**Observed:** SafeTensors offsets were syntax-checked but not fully bounded to the artifact data section and overlapping tensor ranges were not rejected.

**Remediation:** descriptor type, safe integer offsets, payload bounds and overlap checks are enforced.

**Retest evidence added:** `tests/model-artifact-analysis.test.js`.

## Open findings / limitations requiring further work

These items are not claimed fixed by this branch:

1. `server.js` assessment-claim flow has a concurrent claim window between reading an unclaimed assessment and updating ownership. The fix should be an atomic conditional claim/transaction, but `server.js` is intentionally not rewritten wholesale without executable regression coverage.
2. Red-team entitlement/upload-token issuance requires atomic quota reservation to prevent concurrent token issuance from exceeding plan limits. This needs a quota-reservation design tied to token expiry/consumption rather than a cosmetic counter check.
3. Generic webhook integrations remain an SSRF boundary. Current HTTPS/credential/redirect/timeout controls reduce risk but do not provide DNS-rebinding-safe destination enforcement.
4. The repository has no GitHub Actions test status attached to this audit branch. The complete Node test suite and production PostgreSQL integration path must be executed from the normal checkout before merge/deploy.
5. Production customer journeys, Render health/readiness, Stripe webhook processing, email delivery, backup/restore and responsive visual behaviour were not re-verified from this source-only execution environment.

## Required pre-merge validation

From the normal repository checkout, run the existing full test suite plus the newly added focused tests. Any failing test must be diagnosed before merge; do not weaken assertions merely to obtain a green run. After deployment, verify the normal-customer journey from account/sign-in through Northstar Control Intelligence, and confirm that no deployment decision is inferred from runtime completion.
