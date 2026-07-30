# AgentRiskLayer v9.2.0 — Exact-action approval integrity and public evidence proof

Release date: 30 July 2026

## Security control repair

- Replaces caller-controlled `humanApproved`, `productionApproved` and equivalent booleans with server-issued approval tokens.
- Restricts approval issuance and revocation to project administrators and owners.
- Binds every approval to the exact workspace, project, environment, tool and canonical tool arguments.
- Limits approval validity to between 30 seconds and one hour.
- Stores only SHA-256 token digests in the database; the bearer token is displayed once.
- Records authenticated approver identity in the protected ledger and audit trail while omitting the internal user identifier from the bearer token.
- Atomically consumes an approval with the allowed runtime event.
- Rejects changed targets, changed values, expired approvals, revoked approvals and consumed-token replay.
- Uses PostgreSQL row locking for the specific approval record rather than serialising unrelated Guard traffic.
- Records issuance, revocation, consumption and denial evidence without retaining raw tool arguments.

## Public evidence demonstration

- Rebuilds the controlled customer-support-agent demonstration around the full evidence chain:
  Declared Controls → Observed Controls → Findings → Red-Team Evidence → Runtime Evidence → Human Approval → Remediation → Retest → Deployment Decision.
- Adds a downloadable, SHA-256-integrity-protected proof manifest using fictional data and dry-run actions only.
- Removes unsupported performance language and separates implementation evidence from production verification.
- States explicitly that the proprietary assessment is not an accredited certification or a guarantee that a system is risk-free.

## Data and compatibility

- Adds migration `008_runtime_approval_integrity.sql`; it is additive and does not delete or rewrite existing customer data.
- Adds equivalent local SQLite structures for isolated testing and development.
- Includes approval ledger records in authenticated account exports and applies project retention cleanup.
- Uses a nullable approver reference with `ON DELETE SET NULL` so account deletion remains possible when a shared project is retained; active tokens then fail ledger verification.
- Existing project API keys remain valid. Approval-required actions now fail closed until an authorised user issues an exact-action token.
- Local standalone Runtime Gateway does not share the hosted approval ledger and therefore fails closed for approval-required actions.

## Internal validation

- `npm run validate`: 157/157 tests passed, zero failures and zero skipped tests.
- End-to-end smoke journey exercised server-issued approval, changed-value denial, exact action allow-and-consume, replay denial and account export.
- Focused approval gate: 28/28 tests passed.
- Internal synthetic detection regression: 20/20 cases passed with zero false positives and zero false negatives on the stated dataset.
- Deterministic safety regression: 1,000/1,000 scenarios passed with zero unsafe deployment decisions.

## Verification boundary

- Automated results are internal engineering evidence, not independent certification.
- Production deployment, migration application and the live approval journey must be verified against the exact deployed commit before production effectiveness is claimed.
