# ENKYRON — business / ENK-04 integration reconciliation gate

**13 November 2026 — Draft integration planning only. No deployment, migration or merge.**

## Identity and verified evidence

- Actual operator checkout reported: `~/agent-risk-layer`, `feat/miniagent-offline-assessment-lab-20261112`, exact SHA `c7661e8cc64711caab2b37782d43c1e59f92dd51`. The actual launcher process for everyday business has **not** been separately observed.
- Business `arl_local`, peer `emprex`, 115 registered migrations. The operator reports `114_enkyron_ticket_scope_reviews.sql` as latest lexicographical version. This is not proof of `114_enkyron_crm_proposal_content_versions.sql` or `115_enkyron_crm_proposal_archive_event_binding.sql`.
- ENK-04/UX #595 and review #596 are at `9f51aa1ce4f3931f5f51486d4b16668842541745`; CI and Desktop PASS on that branch, but it has **not** been installed or integrated.
- GitHub compare: two branches **diverged**, with 112 commits unique to business and 184 unique to ENK-04 relative to their common ancestor `c6aac9054fc7dc5499164c8b3b99e4db89587930`.
- Source reconciliation needs to preserve the business-only ticket-scope review, evidence integrity, pilot lab and miniagent capabilities alongside ENK-04 CRM code, company-dossier UX and tests. Both sides alter `desktop/enkyron.py`, `desktop/enkyron-bridge.mjs` and workflows.

## Migration identity: two different 114 files

| Current branch / business registry | ENK-04 candidate |
| --- | --- |
| `114_enkyron_ticket_scope_reviews.sql`: immutable documentary technical scope/permission review | `114_enkyron_crm_proposal_content_versions.sql`: immutable full-text proposal revision snapshots |
| Installed in business DB according to operator read-only registry | Tested/installed only in separate synthetic `enkyron_uat_enk03` |
| Must retain its file name and checksum | Original migration 114 content must remain byte-for-byte unchanged |
| Not present at #596 HEAD | `115_enkyron_crm_proposal_archive_event_binding.sql`: composite event/archive integrity, CI only |

The generic migration runner uses **full filenames** as IDs, so numeric prefix duplication is not by itself a SQL error. It does **not** check for registry rows whose source files are absent from a candidate branch. Do not rename already-installed migrations or assume `max(version)` identifies the largest number of compatible migrations.

## New explicit read-only preflight

`node scripts/enkyron-business-migration-preflight.mjs --check` is the **only permitted command** in this new script. It uses local peer PostgreSQL, a strict read-only transaction, targets `arl_local` only and reports migration names / SHA consistency, not customer records.

It halts for missing historical migration sources, changed checksums or pending candidate migrations. It explicitly reports numerical prefix collisions without treating different full names as the same migration. A non-clean result is a **STOP requiring review**, not a request to apply scripts.

The script is **in this Draft branch only** and is not yet installed on the operator checkout; do not ask the operator to execute a non-existent local file. Unit tests use synthetic arrays and no PostgreSQL.

## Reconciliation / UX acceptance sequence

1. Preserve original business SHA and #595 SHA unchanged. Create a separate reviewed **code integration candidate rooted on the business branch**, not on `main`; preserve the technical scope 114 and both commercial migrations 114+115, and re-run the migration manifest checks.
2. Perform conflict-aware source merges, with specific review of company/dossier UX, bridge allowlists, assessment scope controls and side effects. Preserve both pilot/assessment capabilities and ENK-04 CRM, not an unconditional replacement of either `enkyron.py`.
3. Run independent CI, Desktop smoke and real PostgreSQL tests **on a disposable database** with all three 114/115 migration records and historical checksum identities. Do not reuse `enkyron_uat_enk03` for mutation.
4. Review a genuine read-only inventory of `arl_local` before any separate backup, clone, restore rehearsal or schema application. No data sync from synthetic UAT to business.
5. Human UX review: Company 360 opportunity→qualification→unsent GBP draft; correct action states; archived R1/R2 viewer; human rationale; no dead-end R2 correction button; clear missing-data, stale-data, cancel and ambiguous-IPC messages; preserve My Work, Mail, evidence and pilot navigation.
6. After all checks: request **explicit human release/merge/migration authorisation**, plan rollback and actual business launcher identification. No implicit upgrade and no external send.

**Status:** migration continuity preflight is a first safety prerequisite, NOT a complete merge or permission to touch the business database. Parent [#584](https://github.com/emprex/agent-risk-layer/issues/584); overview [#596](https://github.com/emprex/agent-risk-layer/pull/596). ENKYRON may remain closed.
