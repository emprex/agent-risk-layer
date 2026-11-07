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
| E02-04 Search/deduplicate | Bounded search and reviewed prospect linkage exist. E02-04A bounded company/contact identity-clue preview and Qt warning are implemented on the development branch. | Exact-head CI and Debian synthetic acceptance of E02-04A; E02-04B transactional recheck, auditable override, broader duplicate resolution and negative concurrency tests. |
| E02-05 Many-to-many | Contact–ticket link persisted on Debian. E02-05R revocation of synthetic ticket ARL-2026-000004 persisted after restart. E02-05S first reviewed reassignment from `Test` to `ARL CRM Import Test 3d5a49b4` visibly succeeded; operator confirmed restart test PASS on 2026-11-07. Exact-head CI for E02-05S passed on `a90b756`. | E02-05 as a whole remains OPEN: verify historical lineage and separate contact associations in redacted local DB evidence; any further transfer needs separately reviewed correction; real ARL tickets 000001/000002 require explicit operator decision; E02-06 access controls unresolved. |
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

**Next:** E02-04 prudent company/contact duplicate detection (review before create/link, never silent merge) →
E02-03 dossier completeness → E02-06/E02-07 security/privacy closures → full CRM A→Z local acceptance →
commercial opportunity → proposal → invoice-preparation walkthrough.
Avoid adding new buttons where a unified CSV workflow can reuse the existing
export control. Do not merge PR #520 based only on CI.


## Operator acceptance note — 2026-11-07 (E02-05S)

Operator reported a successful restart check after moving synthetic ticket `ARL-2026-000004` from revoked `Test` association to `ARL CRM Import Test 3d5a49b4`. The previous screenshot showed the target company with one active ticket; a separate older screenshot showed the original company with two active ARL tickets and the immutable revocation metadata. This establishes the limited **DONE-LOCAL** user-confirmed test of reassignment and restart persistence; it is not independent verification of PostgreSQL row integrity or broader permission enforcement.

E02-05 parent criterion remains open. Historical ARL tickets `ARL-2026-000001` and `ARL-2026-000002` must not be modified without explicit human review. E02-04 next scope is a read-only, bounded, operator-scoped duplicate preview for company and contact identity clues, coupled to deliberate review, with no automatic merge, company promotion, or consent inference.
