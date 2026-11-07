# ENKYRON CRM — delivery ledger (2026-11-07)

**Source of truth:** `docs/ENKYRON_PSA_ROADMAP.md` block E02 and
`docs/ENKYRON_CRM_ACCEPTANCE_A_Z.md`.
**Current PR:** #520 on `feat/enkyron-desktop-20261105`.
**Rule:** DONE-CI never means DONE-LOCAL. Subfeatures do not close a
parent criterion. This ledger is an evidence-oriented snapshot, not an
assertion of legal compliance or production readiness.

| Criterion | Observed slice | Remaining closure gate |
|---|---|---|
| E02-01 Companies | Create/edit versioning and history; synthetic Debian create/edit demonstrated | Entire A–Z reconciliation and ownership checks |
| E02-02 Contacts | Create/edit and durable synthetic contact demonstrated | Negative stale-version/consent acceptance on Debian |
| E02-03 Company 360 | Nine sections shown in Debian including audit | Contracts/projects/documents remain outside current dossier |
| E02-04 Search/deduplicate | Bounded search and reviewed prospect linkage in CI | Independent duplicate/no-merge scenarios |
| E02-05 Many-to-many | Contact–ticket association persisted after Debian restart, plus CI negatives | Correct wrongly associated historical ARL tickets with audited rectification; no silent unlink |
| E02-06 Audit/access | E02-06A event/field-change views shown in Debian | Authenticated users, roles, isolation and privilege-negative tests |
| E02-07 Privacy/retention | E02-07A request persisted across restart; E02-07B review recorded and read locally | Complete lawful workflows, approved retention schedule, hold handling and Debian restart of 087 |
| E02-08 CSV | E02-08A export verified locally; E02-08B strict preflight CI; E02-08C reviewed import and anti-duplicate/pass after restart in Debian; E02-08D attempt/receipt audit in development | E02-08D exact-head CI and Debian export audit receipt, broader duplicate rules and A–Z reconciliation |

**Commercial E07/E09 boundary:** Opportunity, proposal draft, line pricing,
PDF draft, tax review, buyer/commercial-terms gates and invoice-preparation
components have CI coverage. They have **not** all passed a single end-to-end
Debian test; do not claim invoice issuance or customer authorization.

**Known data integrity issue:** real ARL assessment tickets
ARL-2026-000001 and ARL-2026-000002 were manually associated with synthetic
company Test during acceptance. An audited correction workflow is needed.
Do not destroy immutable audit history.

**Next:** validate E02-08D audit receipts in CI and Debian →
E02-06/E02-07 security/privacy closures → full CRM A→Z local acceptance →
commercial opportunity → proposal → invoice-preparation walkthrough.
Avoid adding new buttons where a unified CSV workflow can reuse the existing
export control. Do not merge PR #520 based only on CI.
