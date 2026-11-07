# ENKYRON — CRM acceptance A→Z (synthetic, single-operator local scope)

**Date:** 2026-11-07  
**System under test:** `desktop/enkyron.py`, `desktop/enkyron-bridge.mjs`, local PostgreSQL `arl_local`.  
**Reference:** `docs/ENKYRON_PSA_ROADMAP.md` (Block E02), plus E07/E09 as downstream customer-journey boundaries.

## Acceptance rules

1. **No assessment/test execution.** All fixtures are synthetic and no real customer is contacted, invoiced or assessed.
2. CI is a test of software implementation on isolated PostgreSQL and offscreen Qt, **not** operator acceptance on the real Debian installation.
3. ENKYRON is currently **one local OS operator**. Workspace keys are not multi-user authentication or real Internet tenant isolation. No external CRM, bank, mail or HMRC connector is included.
4. No false PASS: label each local check `DONE-LOCAL`, `BLOCKED`, `FAIL`, or `NOT-VERIFIED`; attach timestamp, exact Git commit, screenshots/SQL redacted logs, and a human conclusion. For a database error, collect sanitized SQLSTATE; no passwords, UTR, customer data or private source text in evidence.
5. Each mutation must preserve immutable history, avoid cross-workspace access, and never grant marketing consent, change client status or send communication merely because data was edited.
6. Before any manual migration: verify the intended database/operator and checksum, perform backup with owner-only permissions, apply one migration, and then check persistence. Do **not** test destructive operations against live ARL data.

## A→Z acceptance matrix

| ID | Scenario | Actual expected result | CI coverage or missing function | Debian |
|:--|:--|:--|:--|:--|
| A | Launch and PostgreSQL read | Local Qt starts; reads installed schema, handles missing schema safely | GUI + bridge tests | NOT-VERIFIED |
| B | Company create | New **prospect** row with audit event, never verified client | `enkyron-crm-postgres.test.js` | NOT-VERIFIED |
| C | Same-name companies | Two companies with identical names do not merge | CRM PostgreSQL | NOT-VERIFIED |
| D | Company search | Case-insensitive bounded results, operator-scoped | CRM PostgreSQL | NOT-VERIFIED |
| E | Company edit, migration 084 | Version 1→2; `sector`, `city`, etc. saved after human reason | `enkyron-crm-edit-postgres.test.js` / Qt smoke | NOT-VERIFIED |
| F | Company edit conflict | Stale revision and no-op rejected; no extra audit event | CRM edit PostgreSQL | NOT-VERIFIED |
| G | Contact create | Contact belongs to chosen company, consent remains `unknown` | CRM PostgreSQL | NOT-VERIFIED |
| H | Contact edit, migration 084 | Version 1→2; edited email visible; company unchanged | CRM edit PostgreSQL / Qt smoke | NOT-VERIFIED |
| I | Contact safety | Cannot set opt-in, verified relationship or move company via correction | CRM edit unit/PostgreSQL | NOT-VERIFIED |
| J | Workspace separation | Cross-operator company/contact read or edit refused | CRM edit PostgreSQL | NOT-VERIFIED |
| K | Prospect research | Historical source remains read-only; unverified research label | prospect tests, Qt smoke | NOT-VERIFIED |
| L | Association review | Human chooses/create/select, confirms and records source digest | CRM link PostgreSQL | NOT-VERIFIED |
| M | Duplicate prevention | Similar name/domain prompts review; no silent merge | CRM link PostgreSQL | NOT-VERIFIED |
| N | Ticket links | Link authorized existing ticket; company name alone is insufficient | CRM ticket link PostgreSQL | NOT-VERIFIED |
| O | Company dossier 360 | Only explicit contacts/prospects/tickets/opportunities appear | company-dossier PostgreSQL | NOT-VERIFIED |
| P | Opportunity pipeline | Record/update stage and next action with version and history | opportunities/pipeline PostgreSQL | NOT-VERIFIED |
| Q | Manual activities | Call/meeting/email *notes* remain testimony, not transport proof | activities PostgreSQL | NOT-VERIFIED |
| R | Qualification | Human fit/priority with source and immutable review | qualification PostgreSQL | NOT-VERIFIED |
| S | Mail drafts | Saved as internal draft; no real mail transport | mail-drafts PostgreSQL | NOT-VERIFIED |
| T | Proposal revision | Versioned draft, fee, scope; prior revision not silently reused | proposal PostgreSQL | NOT-VERIFIED |
| U | Proposal lines and PDF | Fee rows tied to revision; PDF stays marked internal/unissued | lines + PDF tests | NOT-VERIFIED |
| V | Buyer/terms documents | Buyer source and non-expired commercial terms for exact revision | buyer/terms PostgreSQL | NOT-VERIFIED |
| W | Human tax/internal review | No VAT determination or legal issuance merely from notes | tax/internal PostgreSQL | NOT-VERIFIED |
| X | Invoice readiness | 7-step scoped checklist, prebilling and draft blocked until gates | invoice PostgreSQL + Qt | NOT-VERIFIED |
| Y | Audit integrity | CRM events/revision metadata immutable, changed fields only (not PII snapshots) | CRM edit PostgreSQL | NOT-VERIFIED |
| Z | Recovery and go/no-go | Backup/restoration tested, full journey local, permission and privacy review | **NOT fully implemented/tested** | NOT-VERIFIED |

The matrix tracks **tests**, not completion of all product features. Scenarios E/H require migration 084; no old historical row is rewritten. Existing commercial/financial and ticket records remain intact.

## Known E02 gaps before claiming CRM complete

| E02 criterion | Current engineering assessment | Remaining work |
|:--|:--|:--|
| E02-01 Companies | Implementation plus versioned manual correction | Independent local round-trip, ownership and source review |
| E02-02 Contacts | Implementation plus versioned manual correction | Independent local round-trip, linked-contact checks |
| E02-03 Company 360° | Current 7-section dossier on explicit links | Contracts, projects and document views not built |
| E02-04 Search/duplicate | Bounded search, conscious prospect association | Controlled broader duplicate resolution; no automatic merge |
| E02-05 Many-to-many contact relations | Single contact company ownership implemented | Cross-ticket/contact relationship features and controlled many-to-many modeling |
| E02-06 Audit and access | Append-only local events and operator workspace key | Real user accounts, RBAC/ABAC, consented visibility, negative multi-user tests |
| E02-07 Privacy/retention | Unknown marketing consent by default | Retention rules, GDPR access/export/erasure handling and policy review |
| E02-08 Import/export | No accepted general CSV round-trip demonstrated | Secure CSV import validation/export, encoding, formula-injection resistance, provenance |

**Never declare CRM done merely because the A→Z CI suite passes:** the local operator acceptance and remaining functional E02 gaps above are separate gates.

## Local acceptance sequence after migration 084

Run `node scripts/enkyron-crm-record-edits-schema.mjs --check` and, only on the intended local installation, `--apply` (backup-before-change), then start `python3 desktop/enkyron.py`. Using a **synthetic company and contact only**, verify create → edit → refresh → relaunch → readback. Check a second stale edit is rejected, that contact consent remains `unknown`, and that a real buyer link is **never inferred**. Collect non-sensitive screenshots and confirm no unrelated ticket/prospect/invoice changed. This is a first acceptance slice, not all A→Z scenarios at once.


## E02-06A — CRM dossier audit metadata (2026-11-07)
Two new **read-only** tabs in the existing company dossier: **CRM audit**
(company and current contacts: creation, link, update event metadata) and
**Field changes** (versions, field *names*, operator and timestamp). These are
read in the same PostgreSQL REPEATABLE READ READ ONLY transaction as the other
seven dossier sections, scoped to the exact company and local workspace.
Each preview shows 20 records maximum; no old contact field values or human
free-text rationale is selected in the new audit views. Existing append-only
triggers are reused without alteration; no migration is required.

Qt, unit and isolated PostgreSQL validations are separate from operator
acceptance on Debian (NOT-VERIFIED). E02-06 remains OPEN: true accounts,
RBAC/ABAC, database role enforcement and real multi-organisation tenant
isolation have not been implemented. `local:OS-username` is not auth.

Known limitation: historical ARL assessment tickets were manually associated
with synthetic company Test. Association is an operator assertion, not
verified legal identity, and audited unlink/reassignment is not yet supported.


## E02-07A — Append-only privacy request intake (development 2026-11-07)
Migration 086 creates contact-specific append-only records for access, rectification,
erasure, restriction, objection and portability requests. A human can record an
intake date and channel through Contacts → Privacy requests. Every case stays
`pending_human_review`; it is not approved or fulfilled by saving.
No source record, buyer review, ticket, marketing permission, message,
invoice or audit record is modified, exported, anonymised or erased.
A local PostgreSQL backup and checksum verification are required before
manually installing 086. Operators must not enter real unverified subject
requests for functional acceptance; use synthetic data.

The ICO confirms that UK GDPR does not establish one universal retention
period; controller-specific purposes must justify preservation and deletion:
https://ico.org.uk/for-organisations/uk-gdpr-guidance-and-resources/data-protection-principles/a-guide-to-the-data-protection-principles/storage-limitation/

E02-07 is NOT COMPLETE: identity and third-party authority verification,
deadline assessment, lawful basis/exceptions, legal holds, retention schedule,
request resolution, data export, erasure/redaction and communication all need
further design and human governance. CI is not Debian acceptance.


## E02-07B — Human retention review register (2026-11-07, limited)
Additive migration **087** adds an append-only, local workspace-scoped
review history per CRM contact. Each human entry requires a selected processing
purpose, a *potential preservation concern check* (not assessed, potential,
none identified), a next review date and a 30–500-character rationale.
The Qt **Retention reviews…** dialog lists existing metadata and records
further reviews, never edits earlier reviews. A next review date is NOT a
retention expiry or deletion date. A potential hold is NOT an approved legal
hold; none identified is NOT a legal clearance. No lifecycle action is
executed, no customer information is automatically exported or altered.

The UK ICO storage limitation guidance states that retention varies by
purpose and must be justified, documented and reviewed; no fixed universal
UK GDPR retention period exists:
https://ico.org.uk/for-organisations/uk-gdpr-guidance-and-resources/data-protection-principles/a-guide-to-the-data-protection-principles/storage-limitation/

CI tests use disposable synthetic PostgreSQL, deny out-of-workspace access,
block update/delete of reviews and verify no original contact mutation.
Debian operator acceptance remains NOT-VERIFIED until migration check,
owner-only backup, review recording and readback after restart.

**E02-07 remains OPEN.** No retention schedules have been approved, no
automated purge, actual legal holds, privacy request resolution, data export,
erasure or cross-system deletion are implemented. A review entry is not
authorisation for indefinite retention.


## E02-08A — Selected company CSV export, no bulk import (2026-11-07)
The new **Export CRM CSV…** button exports only the exact selected company and
up to 500 directly associated contacts. The PostgreSQL read uses a single
`REPEATABLE READ READ ONLY` snapshot and the local operator workspace scope.
The response excludes emails, phone numbers, tickets, assessment records,
research sources, invoice contents and free-text rationales. The CSV includes
company identity/status and each contact's name, role, marketing-permission
label and record version. Contact names are personal data; the operator must
explicitly confirm the export and select the local destination.

The Python CSV writer uses UTF-8 BOM, quoted cells and spreadsheet-formula
neutralisation for data starting with `=`, `+`, `-` or `@` after common
leading whitespace/zero-width characters. It refuses incomplete snapshots
(above 500 contacts), unsupported values and existing destinations; newly
created files are owner-only (0600 on Linux) and are never transmitted.
There is **no CSV import** in this increment. No database migration required.

**Not a finished E02-08 implementation:** no logged export receipt, approved
recipient/right-to-export workflow, general multi-company export, secure CSV
import/provenance or round-trip migration. Debian operator acceptance is
NOT-VERIFIED until manually tested on synthetic data. Exported contact names
remain subject to GDPR/privacy handling.


## E02-08B — CSV import preflight, zero database writes (2026-11-07)
The offline `desktop/enkyron_crm_csv_import.py` parser validates the **exact**
selected-company V1 CSV schema and record order. It checks UTF-8 decoding,
1 MiB size, 500-contact bound, unique canonical identifiers, exact company
ownership, versions, fixed headers and cell sizes, hostile spreadsheet
formula cells, malformed quotes and control characters. It returns a SHA-256
digest and a **read-only preview**; no SQL access, consent promotion, customer
identity matching, overwrite, import or remote transmission.
The existing export CSV writer remains unchanged. No new UI button and no
database migration is added in E02-08B.

This is a validation foundation **not a working importer**. A later reviewed
import flow must bind the preview digest to the exact file bytes, require an
explicit human mapping/approval, preserve provenance and event history, enforce
company ownership and existing-record conflicts transactionally, and prove
negative tests against disposable PostgreSQL. Do not copy CSV relationship
or marketing labels into authority-bearing fields. Debian acceptance is
NOT-VERIFIED until a GUI import/preview is available.


## E02-08C — Reviewed new-record CSV import (2026-11-07; local operator only)
**Source format:** the strict UTF-8 CSV selected-company V1 parser from
E02-08B. A single existing toolbar control **CRM CSV…** now offers
**Export selected company** or **Import CSV with human review**.

The importer presents the parsed company, up to 12 preview contact names,
source SHA-256, source client-status label and explicit warnings before
any database write. A read-only PostgreSQL precheck detects an already-imported
file/source company, source-ID reuse and exact normalized company-name
collisions. The operator must provide a 30–500-character reason, confirm
that only NEW records will be created, then confirm again. The CSV is re-read
from disk and its hash/parsed contents verified immediately before the
commit request. The server independently validates all structured fields and
rechecks collisions after a transaction-scoped advisory lock. It uses new
UUIDs, and creates company, contacts, append-only events, batch provenance
and per-contact mappings inside ONE PostgreSQL transaction. Any error rolls
back all related inserts. Migration **088** adds
`source_type=csv_reviewed_import` plus append-only provenance tables.
Backups/checksum verification are required before applying 088 locally.

Source `client` status always imports as `prospect`.
Source contact identity always imports as `unverified`, and source
marketing labels `opt_in/opt_out` import as `unknown`. Contact
email/phone are absent from CSV V1 and remain unset. No merge, deletion,
outreach, authority promotion, ticket/assessment or invoicing changes.
A source exported from the SAME database has already-used source UUIDs and
must be **rejected**, not duplicated. Test real import only with a wholly
separate synthetic source dataset.

**Boundaries / follow-up:** The SHA-256 is checked against file bytes in
the trusted local Qt operator process, not attested by an external signer.
Local OS user identity does not enforce multi-user tenant isolation.
Approximate/fuzzy duplicates beyond exact name and UUID matches still
require manual review. The imported contact status and provenance remain
observable, but a dedicated signed, authorized export receipt is not yet
present. CI tests and any successful Debian acceptance must be recorded
separately. E02-08 is not closed until these gates pass.


## E02-08D — Append-only CSV export attempts and receipts (2026-11-07)
Migration **089** adds an append-only export-event register with **started**,
**completed**, and **failed** events. Only the local workspace, company ID,
source company revision, expected contact count, operator, timestamp, export
ID and (after creation) SHA-256/byte count/record count are recorded. No
filename, storage path, email, phone, contact name, file contents or free-text
review rationale is stored in the receipt table. The two-stage protocol
records intent **before** creating a file. On success, Python reopens the
new owner-only CSV with a no-symlink safeguard, computes SHA-256 of actual
bytes, compares with the pre-serialized snapshot and records completion.
On failure, it attempts to record a failed outcome. A crash or database
outage may leave a started event with no outcome: treat this as an
**unresolved export**, not proof of no file.

The **CRM CSV…** menu reuses its existing button for export, reviewed import
and a read-only **View CSV export history** view. No new toolbar button.
Generated files are bounded to 1 MiB and cannot overwrite a destination.
The operator must still restrict recipients, protect exported contact
names and manage exported files independently; a local receipt is NOT a
customer authorization, legal GDPR DSAR response or cryptographic
remote attestation. Authentic multi-user RBAC and actual retention/deletion
remain OPEN. All CI results and Debian acceptance are tracked separately.
