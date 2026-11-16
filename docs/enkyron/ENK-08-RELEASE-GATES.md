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


## Forensic verification of applied historical 021 (read-only)

GitHub commit `e644d51cfdf256e04989dafc45b4cea4a4e23aa4` from 20 August 2026 contains the original `migrations/021_paid_assessment_remediation_scope.sql`. The SHA-256 of its **exact bytes** is `673d3ce1373cf5dcde3414fee08c3dba15cadb0ca2f32afd7c50316fe5b1d7f6`.

The new tool `scripts/enkyron-enk08-history-021-audit.mjs` takes this fixed archived source with `git show` (no checkout), compares SHA-256 to the fixed historical reference and to the exact **recorded** `schema_migrations` entry in a PostgreSQL **READ ONLY** transaction. It never copies the source into `migrations/` or changes the ledger.

On Debian (normal user, this feature branch):

```bash
cd ~/agent-risk-layer
node --test tests/enkyron-enk08-history-021-audit.test.js
node scripts/enkyron-enk08-history-021-audit.mjs --check
```

If the Git object is unavailable, its bytes differ, the ledger differs, or the historical 021 reappears under active migrations, the audit reports **STOP**, without changing anything. Success proves **historical byte/checksum provenance only**, not migration compatibility or permission to deploy. Follow the pending migration, backup/restore and authorization release gates above.

## ENK-08 single-database activation (Owner MFA, no clones)

This slice uses the **existing** ARL desktop, CRM database and private local Owner MFA bridge. The four PSA mutation commands require a valid short-lived password+TOTP Owner session on **every** write, validated again server-side. No caller-supplied actor/role/workspace is accepted. Planning mission creation, work-item creation and completion, and draft time entry each retain their idempotency and immutable event audit.

The explicit installer is `scripts/enkyron-enk08-install.mjs`. It never invokes the shared migration runner, Mail 114/115/117, pg_dump, PostgreSQL clusters, backups or filesystem deletion. It uses the exact previously reviewed SQL 118/119/120 from `docs/enkyron/sql/`, pins their Git blob IDs and applies them only as one transaction to **arl_local on port 5432**, with the shared migration advisory lock and matching SHA-256 receipt in `schema_migrations`. The business migration preflight recognizes these receipts against the canonical draft files when applied, without copying them to the autoscanned `migrations/` directory.

As a conservative recovery prerequisite, `--apply` accepts only an existing owner-owned, private, intact PostgreSQL custom archive under `data/backups/`, with SHA-256 matching its manifest, source DB `arl_local`, archive listing accepted by pg_restore, and created in the last **24 hours**. It never creates, copies, restores, rotates or deletes an archive. This is an integrity gate, **not a tested restore**; an actual restore test is still recommended before relying on the archive.

Commands on the normal Debian operator account:

```bash
node scripts/enkyron-enk08-install.mjs --check
node scripts/enkyron-enk08-install.mjs --apply
```

The second command requires an interactive exact confirmation `INSTALL ENK08` before touching any schema. It aborts without writes if backup, ledger, table state, SQL hashes, database/user identity or prerequisites are wrong. PSA tables and migration receipts commit or roll back together. Existing CRM/Mail/Tickets data are not rewritten.

After installation, close and reopen ENKYRON, navigate to Projects, authenticate with the existing **Owner MFA**, then create a planning mission from an existing CRM company. Add work items, complete a task and log internal draft time. Confirm that the persisted record survives a desktop restart. A planning mission is not an accepted SOW and these actions never authorize testing.

**Current status:** GitHub code prepared; live database installation and Debian end-to-end acceptance are not asserted until the operator runs the guarded command successfully.
