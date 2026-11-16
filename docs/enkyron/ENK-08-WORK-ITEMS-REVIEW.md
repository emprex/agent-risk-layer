# ENK-08 — Work Items (Tasks & Milestones) · Review-only
Date: 2026-11-16

## Scope and user experience
A Mission groups internal work for one CRM company. Work items are **tasks** or **milestones** under an exact Mission ID; they are not copies of Calendar tasks. A later UI will display these inside the Company 360 Mission dossier and surface assigned work in My Work only after verified role assignment.

## Implementation boundaries
- `desktop/enkyron-psa-db.mjs` centralizes local actor/UUID validation and transactional rollback instead of duplicating helpers in each service.
- Existing `desktop/enkyron-psa-missions.mjs` reuses those helpers without changing mission behaviour.
- `desktop/enkyron-psa-work-items.mjs` exposes create, completion and bounded list. Inputs are strictly validated by the established contract module; all SQL is parameterized and scoped to the trusted local OS operator.
- `docs/enkyron/sql/119_enkyron_psa_work_items.sql` is additive DDL, **not a deployable migration**. It is deliberately outside `migrations/`. It requires separately approved planning schema 118.
- New task/milestone content is idempotent via `request_id` and SHA256; completion requires a matching item/mission/request version, a row lock and an immutable event in the same transaction.
- Work items are limited to `open` and `completed`. Completion does **not** grant a service engagement, contract approval, SOW approval, security testing authorization, billing permission, or an ARL assessment verdict.

## Testing
Eight new unit/mock/static tests passed in an isolated Node 22 environment; 22 total relevant mock/contract tests passed after the shared-helper refactor. The existing guarded `pg_virtualenv` test is extended to apply 118+119 **only inside its randomly named synthetic CI schema**, then test FK isolation, concurrent create/complete retries, audit immutability, rollback, and SQL constraints.

On Debian:
```bash
node --test tests/enkyron-psa-planning-contract.test.js tests/enkyron-psa-missions.test.js tests/enkyron-psa-work-items.test.js
pg_virtualenv -v 17 bash scripts/enkyron-psa-virtualenv-rehearsal.sh
```

No claim of PostgreSQL pass until this exact revision is tested on the user's ephemeral PG17 cluster. Mock tests do not prove database correctness.

## Release STOP
- Local `arl_local` migration preflight remains STOP: historical 021 missing from active sources; pending 114/115/117. Do not run `runMigrations` or deploy 118/119 without a reviewed migration plan, a verified restorable backup and full-schema rehearsal.
- The OS operator workspace model is **not authenticated multi-user RBAC**. Never enable a remote API for this service. No bridge routing, PySide6 Mission Board, My Work assignment or Time Tracking write functions are enabled yet.
- Approval/contract and active-assessment authority remain outside this module. For GUI and multi-user access, enforce a verified server-side identity-to-permission mapping and review authorization at each operation.
