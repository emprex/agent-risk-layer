# ENK-08 — Release-readiness gates (NOT a deployment approval)

Date: 16 November 2026. Branch: feat/enkyron-enk08-time-tracking-20261116.

## Verified evidence

The latest Debian 13 / PostgreSQL 17 rehearsal reported 16/16 Python/Qt tests and 30/30 targeted Node tests, including genuine PostgreSQL integration on a disposable cluster. The cluster was destroyed afterward. These results do not prove live database release readiness.

## Historical migrations: release STOP

The existing `src/migrations.js` automatically executes every pending numbered `migrations/*.sql` by **full filename** and SHA-256. SQL comments such as "REVIEW ONLY" do not stop it.

The earlier read-only migration preflight identified:
- Previously applied `021_paid_assessment_remediation_scope.sql` missing from the active source tree. Trace its exact applied SHA and archived bytes; do not guess, re-create or edit the ledger.
- Pending `114_enkyron_crm_proposal_content_versions.sql`, `115_enkyron_crm_proposal_archive_event_binding.sql` and `117_enkyron_mail_document_dossier_links.sql`.
- Multiple shared numeric prefixes across distinct full-file IDs (not necessarily a conflict).
- `117` says "REVIEW ONLY" but is in the auto-scanned directory.
- PSA schema drafts `118`, `119` and `120` remain under `docs/enkyron/sql/`, not the loader's migration path.

Do not change production migration files, `schema_migrations` or business records solely to force a green result.

## New read-only catalog audit

On the normal Debian operator account, using the reviewed feature branch:

```bash
cd ~/agent-risk-layer
node --test tests/enkyron-enk08-catalog-preflight.test.js
node scripts/enkyron-enk08-catalog-preflight.mjs --check
```

The second command intentionally returns **RELEASE STOP (exit status 2)**, including when the structural checks pass. It is a diagnostic, not an instruction to migrate.

The audit:
1. Uses only the local PostgreSQL Unix socket at port 5432, database `arl_local` and current local OS peer user. It ignores `DATABASE_URL`.
2. Uses a repeatable-read, read-only transaction and verifies database, user, read-only mode and statement timeout.
3. Compares current migration file names/checksums to the existing `schema_migrations` ledger without changes.
4. Reads only `pg_catalog` structural metadata for CRM companies/opportunities, their company association, immutable audit function and unexpected pre-existing PSA tables under public.
5. Never reads customer, opportunity, email, invoice or assessment records. It never writes any database row or executes DDL.

A compatible catalog is not proof that all data obeys the planned constraints, nor a verified backup or approval.

## Remaining release sequence

1. Independently trace historical applied 021 bytes/checksum and review all pending 114/115/117 migrations and their dependencies, without rewriting history.
2. Make a PostgreSQL backup and **prove its restoration** in a separate controlled environment.
3. Test the full migration chain and drafts 118/119/120 against a complete-schema disposable clone, with regression and rollback checks. Never auto-copy drafts into the active loader.
4. Implement verified identity-to-operation permissions in the bridge/backend. Local OS workspace scoping is **not** multi-user RBAC. Signed SOW and separately approved security test authorization remain separate gates.
5. Integrate real Company 360/Mission Board operations, My Work assignments, time review/corrections, and final Debian UAT.

**Release decision now: STOP.** Catalog checks only reduce uncertainty; they do not authorize live writes.
