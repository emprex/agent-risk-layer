# AgentRiskLayer v9.3.0 — Release validation

Generated: 2026-07-30T22:29:45.407Z

## Decision

**Implementation validated; production deployment and authenticated browser verification required.**

The candidate repairs the post-sign-in customer journey. The control plane now starts with one plain-language next action and a one-click fictional protection check. Specialist controls remain available through progressive disclosure rather than being removed. The guided route uses the same hosted policy and exact-action approval engine, but does not expose an API key or approval token, does not modify the published customer policy and does not execute an external tool.

## Automated evidence

- Complete isolated suite: **159/159 passed**, 0 failed, 0 skipped.
- Focused guided-journey and approval gate: **33/33 passed**.
- End-to-end smoke: authenticated project creation, one-click guided check, four expected decisions, no bearer/API-key disclosure, unchanged policy, existing exact-action approval flow, export and account deletion passed.
- Syntax and source checks: passed.
- Internal synthetic detection regression: **20/20 passed**, with the stated limited dataset.
- Deterministic safety scenarios: **1,000/1,000 passed**, 0 unsafe deployment decisions.

Evidence files are listed in `RELEASE_VALIDATION.json`.

## Customer and security outcomes

- Default customer view asks one question and recommends one next action.
- Community users with one active project are directed to continue with that project rather than create another.
- The safe check requires an authenticated project owner or administrator.
- Each check runs missing-approval, changed-value, exact-action and replay decisions through the hosted engine.
- The server creates and consumes the exact-action approval internally; the browser never receives the token.
- Synthetic events are labelled `guided_demo`, use fictional data, consume four monthly checks and are excluded from deployment-readiness evidence.
- API keys, policy internals, inventory, approvals, remediation and audit evidence remain available under **Technical controls**.

## Data and migration safety

No database migration is required. Existing projects, policies, keys, approvals, runtime events and billing records are preserved. The change adds an authenticated route and synthetic runtime/audit records using existing v9.2.0 structures. Normal retention and account-export controls continue to apply.

## Verification limitations

- The gate excluded production database, Stripe, email and Render credentials.
- No Render deployment or live authenticated browser journey was performed from this environment.
- Automated browser screenshot rendering was unavailable because local browser navigation was blocked by administrator policy. HTTP smoke, source-level customer-journey tests and responsive CSS checks are the available internal evidence.
- This is internal engineering validation, not independent usability research, penetration testing, accredited certification or a guarantee that AgentRiskLayer is risk-free.

## Production deployment gate

1. Review and commit only the intended v9.3.0 files from the verified `1b13b1938c492e83370d585074ba08e25c1bb37a` v9.2.0 baseline.
2. Deploy through the existing Render path without changing Stripe, DNS, email or PostgreSQL services.
3. Verify `/api/ready` returns version `9.3.0`, production stage and healthy PostgreSQL with migration 008 still current.
4. Sign in as an ordinary owner and verify the control plane opens in guided mode with one clear next action.
5. Run the safe protection check and confirm deny, deny, allow, deny with no terminal, API key or approval token.
6. Verify Technical controls still expose existing policy, key, inventory, remediation and audit functions.
7. Check desktop and mobile layouts manually and record any usability defect before the deployment decision.
8. Review logs, usage impact, monitoring and rollback readiness.
