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
