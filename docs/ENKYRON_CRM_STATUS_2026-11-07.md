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
| E02-03 Company 360 | Debian screenshot 2026-11-07 confirms eleven readable sidebar sections. CI validates ticket provenance and draft commercial records; this slice adds operator buyer documentary reviews and internal proposal decisions to existing Commercial drafts chronology | Exact-head CI and Debian acceptance of added review sources; signed contracts, delivered projects, independent documents and external exchanges not implemented |
| E02-04 Search/deduplicate | E02-04A company duplicate warning seen on Debian 2026-11-07. E02-04B manual creation transaction-time recheck, advisory serialization and override audit in development. | Exact-head CI and Debian synthetic acceptance of override/refusal; contact duplicate confirmation; other creation and edit entrypoints require separate consistency review. |
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

## E02-03 commercial draft provenance slice (development)

The existing company dossier reuses three already-stored types: proposal drafts (072),
pre-billing worksheets (081) and unissued invoice drafts (082). A single bounded,
read-only snapshot query follows **explicit** company–prospect–opportunity joins,
not similar legal names or email domains. It shows record type, title, recorded
status/revision/date and proposal ID; it never reclassifies drafts as accepted
contracts, delivered projects, sent messages, tax invoices or customer decisions.
No migration, extra main navigation or assessment action. Exact-head CI and
real Debian acceptance are separate gates. E02-03 remains OPEN.

## E02-03 internal ticket history slice (development, 2026-11-07)

The company 360 view reads metadata from existing `arl_workbench_ticket_events`
and `arl_workbench_notes` ONLY through `enkyron_crm_effective_ticket_links`.
The preview is read-only, bounded to 20 records with exact count, sorted by
recorded timestamp, and retains ticket number/ID, source record ID, kind, author
and date. Raw event detail and note body are never read into the dossier.
Revoked original associations are not treated as current; reviewed reassignment
is the canonical link. No inference from company name, migration, separate
service, additional main menu action or external communication. A note is
not a customer email or an approved contract. The previous nine-tab Debian
acceptance does not cover this slice. Local acceptance remains open.

## E02-03 commercial terms source-link increment (2026-11-07, CI pending)

Inspection confirmed the existing `079_enkyron_crm_proposal_commercial_terms.sql`
table stores one immutable `operator_draft_unapproved` terms record per proposal
revision. No approved or signed contract is modelled there. The existing
read-only company 360 Commercial drafts SQL now includes the terms record ID,
proposal ID, revision, recorded date and explicit draft status. Links follow
company -> reviewed prospect -> opportunity -> proposal -> terms, with the
operator's workspace key at every edge. No term bodies, payment details,
exclusions, assumptions or source references are exposed in the overview.
No migration, acceptance flag, status promotion or new UI button. Contract
and service-project features remain planned (E07/E08); CI tests and local
Debian acceptance have different evidence gates.

## E02-03 dossier legibility — desktop Qt navigation (development, 2026-11-07)

Operator screenshot after Debian fast-forward to `937424f` showed a correctly
loaded 11-section dossier but horizontally overflowing tab titles and a cramped
company summary. The Qt-only change keeps the existing `QTabWidget` pages and
qualification form, hides the horizontal tab strip, and adds an explicit left
`QListWidget` with all eleven section names and record counts. Selection stays
synchronised in both directions and preserves the currently selected section
across refresh. The summary is broken into distinct labelled lines; the notice
is no longer a duplicate list of counts, and tables use bounded user-resizable
columns with horizontal scroll rather than compressing email/ID columns.
No bridge/SQL/migration changes, no altered records or CRM permissions. The
previous screenshot proves data loading, not the new layout: exact-head CI
and updated Debian visual acceptance remain separate gates.

## E02-03 effective ticket provenance and technical source references (development)

Debian operator screenshot at 14:08 shows the vertical navigation, complete
company summary and eleven sections. The next read-only ticket preview identifies
current CRM association as `reviewed_initial_link` or
`reviewed_reassignment`, with reviewer and timestamp. Classification uses
the current `enkyron_crm_effective_ticket_links` and immutable reassignment
records under the same workspace, not old/revoked lineage or client-name
similarity. Tickets can contain FK-backed ARL technical project and assessment
identifiers: these are technical references and are **not** signed customer
engagements or proven delivered missions. Raw scope/permission references and
review notes remain hidden. No new section, new table, migration or change
to historical ticket/CRM data. CI tests intentionally reassign a synthetic
ticket to a reviewed same-name twin and require zero current ticket/history
in the former dossier. Full E02-03 and E02-05 remain OPEN.

## E02-03 pre-contract documentary chronology (development, 2026-11-07)

The existing `Commercial drafts` company preview now includes two additional
immutable **source records** already present in migrations 078 and 080:
`buyer_documentary_review` with `operator_documented_unverified` status, and
`internal_proposal_decision` with its source decision `needs_changes` or
`internal_draft_approved`. The second is *internal draft* approval only and
cannot prove customer signature or authorise testing, issuing quotes, invoicing
or launching a mission. Both are linked through the same explicitly reviewed
company-prospect-opportunity-proposal chain, with workspace scoping at every
step. Only kind, source ID, revision, status, proposal ID and timestamp are
shown. Legal name/address, evidence references, buyer review notes and internal
decision rationale remain out of the dossier overview. No new table, contract,
project, legal assertion, permissions, email or navigation is created. Source
read remains read-only/repeatable, capped to 20 and count-preserving; local
Debian acceptance remains separate from GitHub CI. E02-03/E07-05/E07-08/E08-01
remain OPEN.
