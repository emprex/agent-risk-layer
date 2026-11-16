# ENK-08 — Mission Planning Boundary (first code slice)

**Base:** `8f769d185658db7b4d2ffd07878ef5f7b590bf15` on `sync/enkyron-20261116`.
**Scope:** Pure validation contract and negative tests only; not a deployed feature.

## Purpose

A *Mission* groups work and deliverables owed by the business to a client. `My Work` is the operator's cross-module action list. A mission's assigned work may eventually appear in My Work, but the two are not competing sources of tasks. No second CRM company/opportunity table is authorised.

## Enforced by this slice

- Mission creation requires one explicit canonical company ID; optional opportunity ID is only a **candidate** and must be checked for the same company/workspace by the eventual service.
- All newly proposed missions have `planning` status. Never infer accepted engagement, SOW approval, security test authorisation or signed contract from a CRM stage or documentary reference.
- User input cannot set actor, workspace, assignee, approval, status or money fields. Those must come from trusted service-side identity and policy.
- Explicit human confirmation and a structured per-operation `request_id` are required for future idempotency handling. Their presence alone does **not** guarantee idempotency.
- Tasks/milestones are proposed as mission-specific work, not copies of `enkyron_calendar_tasks`.
- Completion contract requires expected version and explicit confirmation. Future service must enforce version checks inside a transaction.
- Text/IDs/dates are bounded and validated. This validator alone is not an authorisation boundary or SQL defence.

## Not yet implemented / release STOP

1. Database schema, migrations and persistence.
2. Verified authenticated identity and back-end role/permission enforcement; current local OS actor is **not** multi-user tenant RBAC.
3. Same-workspace and same-company relation checks, FK constraints, immutable audit events and transactional idempotency.
4. PySide6 Mission Board UI, bridge routing, My Work integration and Debian UAT.
5. Signed/approved SOW gate and activation of contractual work. No active security tests are delegated here.
6. Independent disposable PostgreSQL integration tests and database backup/restore verification.

The project has a read-only migration preflight STOP: historical `021_paid_assessment_remediation_scope.sql` is recorded/applied locally but missing from the current active migration directory; other migrations remain pending. **Do not call `runMigrations`, modify `schema_migrations`, or apply any new PSA migration until the full release migration plan is reviewed and the database is protected.**

## Acceptance of this first slice

Run `node --test tests/enkyron-psa-planning-contract.test.js` on exact commit; repeat with `node --check` on the module and test. This validates only the input contract. An operator cannot yet create missions in ENKYRON.
