# ENK-08 — Manual Time Entries & Mission Board UX (review-only)

**Date:** 16 November 2026
**Base:** feat/enkyron-enk08-mission-board-gui-20261116
**Status:** Development; database migration and live GUI writes **NOT approved**.

## Business workflow

A planning mission may contain independent work items (tasks/milestones) and manual internal time logs. Every logged period is tied to an exact mission and may optionally refer to one work item within that mission. Logs are not calendar appointments. They are **internal drafts**, not an approved timesheet, payroll, billing line, customer work acceptance or authorization to conduct security tests.

Inputs: confirmed operator action, UUID mission ID, optional UUID work item ID, work date YYYY-MM-DD, 1–720 whole minutes, non-empty explanatory note (10–500 characters), and an idempotent UUID request ID. An untrusted client cannot set actor, workspace, billable/approved status or service contract authority.

## Backend and data integrity (review only)

- The planning contract gains a strict manual-time-entry validator.
- New isolated desktop/enkyron-psa-time.mjs service provides create/list; it **is not connected** to an external API or ENKYRON bridge.
- Creation validates the mission and optional work item within the same local workspace, uses parameterized SQL, a unique request ID, a single transaction and an immutable audit event.
- Identical retries return one record; reuse of a request ID with different content fails. Direct cross-workspace/cross-mission foreign key violations are rejected.
- Entries and audit events are immutable in the SQL draft. Corrections must be separately designed as auditable new records; no in-place amendment is enabled.
- SQL draft 120 lives at docs/enkyron/sql/120_enkyron_psa_time_entries.sql, **outside migrations/**. No schema change is made to arl_local.
- Bounded reads return up to 50 entries and a separate total count/minute sum. It is still the local OS operator scope, **not tenant RBAC**.

## Native Qt review changes

Operator screenshots from 16 November showed that the Missions table truncated both Company and Mission fields and that card styling bled into the counter labels. The Qt layout now:

- Uses one wider, two-line Mission/Company cell with a full tooltip, plus due date/progress.
- Scopes metric card styling to its own frame, avoiding nested text borders.
- Provides **Tasks & milestones** and **Time entries** tabs within the selected mission, with a fictional sample of 4h 15m for the first mission and 0h 45m for the second.
- Adds a disabled **Log time** control and an explicit reminder that internal hours are not approved or billable.
- Preserves explicit disconnected empty state and no database bridge. All sample clients and logs are fictional.

## Tests and gates

Extended Python model, Qt smoke and static wiring tests; a new set of Node contract/mock/static tests covers time validation, linked IDs, idempotency, audit rollback and bounded reads. The guarded pg_virtualenv integration now loads **118 + 119 + 120 drafts only into its disposable CI schema** and checks real PostgreSQL constraints, concurrent retries, immutable entries and audit, bad links, attempts to mark time billable and event-insert rollback.

Debian review command, as the normal user:

```bash
cd ~/agent-risk-layer
bash scripts/enkyron-psa-disposable-check.sh
```

This single wrapper runs Python syntax/Qt checks, Node syntax checks, the full targeted Node tests (including manual time tests), and real PostgreSQL 17 integration on a guarded **disposable** cluster. 'PASSED' means these synthetic review checks succeeded, not approval to deploy or assess a customer system.
**Important:** Tests on this exact commit have not yet been executed on the operator's Debian. Previous branch: 22 pure/Node tests, 15 combined PG test process, 13 GUI Python tests were reported as passing. New tests must be evaluated independently.

## Release STOP — never bypass

- arl_local migration preflight remains STOP due to historical 021 absent and pending 114/115/117. Do **not** move 118–120 under migrations, edit schema_migrations, or apply the review SQL to arl_local.
- Proper user authentication, roles, inter-workspace controls and operation-to-permission mapping are NOT yet implemented for ENK-08. Do not enable real creation/completion/logging buttons through Qt. No network service is provided.
- ENK-07 signed SOW/authorization verification, planned→active state transition, deliverable management, assignment/My Work, time corrections/approvals, billing, reporting, recovery and full-schema compatibility remain outstanding.
- Only an approved release plan, backup+restore verification, full-schema rehearsal and explicit human operator acceptance may authorize live writes.
