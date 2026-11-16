# ENK-08 — Full-schema, zero-customer-data migration rehearsal

**Date:** 16 November 2026 · **State:** isolated review rehearsal, NOT a live deployment

The operator's read-only checks have established:
- All **8/8** ENK-08 catalog audit tests passed, with `crm_catalog_compatible_for_draft_review=true` on `arl_local`.
- The historical applied `021_paid_assessment_remediation_scope.sql` source exists in Git history (commit `e644d51cfdf256e04989dafc45b4cea4a4e23aa4`) and exact SHA-256 matches the recorded migration ledger. The source stays absent from the active folder.
- The source/ledger comparison still reports three pending files: `114_enkyron_crm_proposal_content_versions.sql`, `115_enkyron_crm_proposal_archive_event_binding.sql`, and `117_enkyron_mail_document_dossier_links.sql`. No live migration has been executed.

## Migration dependencies reviewed

1. **114 — CRM proposal archives:** new immutable content-version table. References existing CRM proposal drafts, immutable proposal events and shared immutable audit function.
2. **115 — proposal archive/event exact identity:** must follow 114. Creates a unique key on proposal draft events, adds a composite FK for workspace/proposal/revision/event/content hash and validates it. A real database with pre-existing content rows could fail validation, so schema-only tests cannot establish production data compatibility.
3. **117 — Mail document dossier links:** new immutable association table. Requires existing mail attachment quarantine primary key, CRM company scoped identity, workbench tickets and shared audit trigger function.
4. **118/119/120 — PSA missions, work items and internal time:** remain review-only draft SQL files outside `migrations/`. They have already passed isolated synthetic PostgreSQL integration, but not a full live-schema rehearsal.

The repeated numeric prefixes 114 and 117 do not themselves prove a collision: the loader keys by exact full filenames. However, the loader currently auto-applies all pending files in `migrations/`, and **comments labelled REVIEW ONLY do not stop it**.

## Dedicated rehearsal

Run as the normal Debian operator on the reviewed feature branch:

```bash
cd ~/agent-risk-layer
node --test tests/enkyron-enk08-schema-only-rehearsal.test.js
pg_virtualenv -v 17 bash scripts/enkyron-enk08-schema-only-rehearsal.sh
```

The script uses the already installed PostgreSQL 17 `pg_virtualenv` to start a disposable database cluster on a non-5432 port. Before any SQL write to the temporary server, it checks the actual virtual cluster config/data paths, marker, local owner and port.

It also:
- Confirms exact expected `arl_local` ledger/pending status **in read-only mode**, and verifies historical 021.
- Pins all six reviewed SQL file **blob hashes** (including working-tree modifications) and refuses drift.
- Reads the live database exclusively using fixed local socket, current OS identity and `default_transaction_read_only=on`. It transfers **schema definitions only** with `pg_dump --schema-only --no-owner --no-acl`, NOT customer/business data rows, mail contents or attachments.
- Creates an empty full-schema replica in the temporary cluster, verifies expected objects and no already-created targets, then executes pending 114/115/117 and draft 118/119/120 in that order, all in **one transaction on the temporary database only**.
- Asserts eight expected destination tables exist and lets `pg_virtualenv` destroy the temporary cluster after exit.

**Important limitations:** This rehearsal does NOT verify customer-record FK compatibility, privilege grants or row-level security with the live role configuration, historical application equivalence, **backup restoration**, database performance, credentials, external integrations, legal acceptance or multi-user authorization. It does not resolve the preflight STOP or authorize moving review SQL into the active loader.

## Release gates still STOP

1. Produce an access-controlled/encrypted backup of the actual database and verify restore integrity in isolation before any live schema change.
2. Rehearse **data-populated** constraints and full migration ordering on a controlled restore (never run pending migrations directly on `arl_local`).
3. Implement verified backend/bridge operation permissions and local principal trust; do not equate `local:<user>` with multi-tenant RBAC.
4. Review, explicitly approve and sequence deployment SQL, with rollback/recovery plan.
5. Connect real Mission Board / My Work / time workflows, then run complete operator UAT, assessment/SOW authority checks and regression coverage.

**Release decision:** STOP. An isolated schema-only pass is just additional evidence.
