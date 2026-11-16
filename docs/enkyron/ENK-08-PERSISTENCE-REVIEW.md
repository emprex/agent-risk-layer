# ENK-08 — Mission Planning Persistence (review-only development slice)

**Parent:** `1f9111b13629654768a8910a5955465f52ccac29` (`feat/enkyron-enk08-planning-boundary-20261116`)

## Intended business behaviour

One local, manually confirmed mission-planning record belongs to **one existing CRM company**. It may refer to one **directly company-linked** CRM opportunity. The service neither accepts a customer engagement nor approves a SOW or test authorization. `won` in the CRM is not a contractual or testing authority. The `planning` status is SQL-enforced.

## Changes

- `migrations/118_enkyron_psa_mission_planning.sql`: review-only additive schema for missions and immutable creation events; composite foreign keys enforce same workspace/company for directly linked opportunities; unique request ID prevents duplicate creations; **not applied**.
- `desktop/enkyron-psa-missions.mjs`: narrow `createMissionPlan`/`listMissionPlans` functions, with validated requests, server-side actor parameter, parameterized queries, bounded list, transactional audit and idempotent retries.
- `tests/enkyron-psa-missions.test.js`: mocked database tests for successful creation, cross-scope rejection, retry/different payload, conflict, audit failure/rollback, list scoping and static schema invariants.

## Security boundaries and limitations

- The local OS operator-derived workspace (`local:<actor>`) preserves the existing product's local partitioning convention. This **does not authenticate remote clients** and **does not implement tenant RBAC**. Never expose these functions through network/IPC with a user-provided actor. No bridge route exists yet.
- Backend checks company and direct opportunity ownership in the same transaction. Schema uses matching composite foreign keys to retain the invariant on future changes. Legacy prospect-only opportunity associations are **not** inferred from names or email addresses.
- Every accepted request has an explicit `request_id` (UUID). A retry with identical normalized content returns the existing mission. Reusing a request ID for different content is rejected. PostgreSQL unique constraints and `ON CONFLICT` implement the concurrency guarantee; a disposable Postgres test is still necessary to confirm execution.
- An audit insert failure triggers a rollback of the parent mission. The audit table has an immutable-update/delete trigger using the existing CRM function.
- There is no task persistence, ownership assignment, SOW approval, contract activation, invoicing, security assessment execution, calendar duplication, or external communication in this slice.
- Service functions can be invoked only by trusted caller code. **No bridge wiring or GUI use is approved** until actor source, command allowlist, UAT flags and permission enforcement have been reviewed.

## Tests and release gates

Local isolated Node.js 22 test run:

```
node --check desktop/enkyron-psa-missions.mjs
node --check tests/enkyron-psa-missions.test.js
node --test tests/enkyron-psa-missions.test.js
# 9 passing mock/static tests
```

**Not tested:** real PostgreSQL 118 application/rollback, lock races, SQL query plans, complete regressions, Debian GUI. An acceptance result is not implied by unit tests.

**RELEASE STOP:** `arl_local` has a pre-existing read-only migration preflight STOP: historical `021_paid_assessment_remediation_scope.sql` applied but missing from current source tree; migration files `114_enkyron_crm_proposal_content_versions.sql`, `115_enkyron_crm_proposal_archive_event_binding.sql`, `117_enkyron_mail_document_dossier_links.sql` are unapplied. **Do not run migrations against arl_local** or edit its migration ledger. Before any deployment: inventory, approved reconciling migration plan, verified restorable PostgreSQL backup, disposable DB rehearsal, actual SQL integration and concurrency tests, backend permissions audit, controlled UI integration and owner acceptance.
