# ENK-03 — UAT-01, Company 360 native workflow

**Status:** IN PROGRESS / NOT ACCEPTED — operator Debian UAT-01 company and contact creation observed; remaining checks pending  
**Scope:** PR #583, stacked on PR #582. This is a manual **business-flow acceptance**, not a replacement for existing CI.  
**Authority:** Human operator decides whether UAT passes. A GitHub CI success does not prove desktop behaviour.

## Safety and starting state

- Do not switch/reset the existing `~/agent-risk-layer` pilot branch or remove untracked `data/backups/` artifacts.
- The known pilot local branch, database `arl_local`, and KYRTHOS/ARL assessment history are **not** the test target.
- First record local branch, HEAD, untracked changes, installed Qt/Node versions, and database connectivity **read-only**. Do not open the new code on the live business DB until an isolated synthetic DB and recovery procedure have been verified.
- Test only in a separate checked-out PR #583 preview with a **separate PostgreSQL test database**, synthetic company/contact records, and no real mailbox/provider connection.
- No mail send, invoice issue, assessment execution, migration on a live DB, ticket creation or contract acceptance is authorised by this UAT.

### Read-only preflight (safe on the current laptop)

```bash
cd ~/agent-risk-layer || exit 1
printf '\n=== LOCAL BRANCH / HEAD ===\n'
git branch --show-current
git rev-parse HEAD
printf '\n=== LOCAL CHANGES (DO NOT DELETE) ===\n'
git status --short
printf '\n=== RUNTIMES ===\n'
python3 --version
node --version
printf '\n=== POSTGRES READY ===\n'
pg_isready -h 127.0.0.1 -p 5432
```

This step only observes the existing laptop. It does **not** install PR #583 or run any write test. If it differs from the known branch, stop and reconcile before setting up the preview.

## Synthetic PostgreSQL isolation gate (ENK-03 preview only)

**Implementation in PR #583:** `desktop/enkyron-uat-database.mjs`.
The normal production/local operator target remains `arl_local` when no UAT
environment variables are present. To enter the synthetic test mode, **both**
`ENKYRON_UAT_DATABASE=enkyron_uat_enk03` and
`ENKYRON_UAT_GUARD=ENK03_SYNTHETIC_ONLY` must be present. Any other name,
missing gate or incorrect marker is rejected **before business queries**.
The service checks a row with marker `ENK03_SYNTHETIC_ONLY` in
`public.enkyron_uat_guard` inside that exact database. This row must be
prepared only inside a separate, verified synthetic database; the application
never creates it automatically.

- The UAT bridge accepts only the narrow Company 360 CRM commands, including
  synthetic company, contact, company-only opportunity and company-follow-up
  creation. Mail sends, assessment writes, ticket creation and invoice actions
  are rejected. Owner login/mail routes and Python ARL reader adapters are
  blocked in UAT.
- This prevents accidental targeting of `arl_local` **only if the test
  environment variables are correctly supplied to the entire desktop process**.
  It is an operational interlock, not a security boundary or a substitute for
  a dedicated PostgreSQL role with limited grants.
- **Do not launch ENKYRON on the new preview without the UAT target variables.**
  An ordinary launch continues to use `arl_local` by design.
- The test database must be fresh and synthetic, **never a copy of
  `arl_local`**, and no live mailbox/provider credentials should be loaded.
- Do not infer that a database is ready from `pg_isready`. Before creation,
  inspect PostgreSQL role privileges, existing database names and available
  migration tooling in read-only mode. On 12 November 2026 the operator
  confirmed a synthetic `enkyron_uat_enk03` with all 113 migrations and
  `ENK03_SYNTHETIC_ONLY` marker; no pilot data was copied.

### Next local read-only test database preflight

```bash
cd ~/enkyron-ux-preview-583 || exit 1
git rev-parse HEAD
psql -X -d postgres -v ON_ERROR_STOP=1 -P pager=off \
  -c "SELECT current_user, rolcreatedb, rolsuper FROM pg_roles WHERE rolname = current_user;"
psql -X -d postgres -v ON_ERROR_STOP=1 -P pager=off \
  -c "SELECT datname, pg_get_userbyid(datdba) AS owner FROM pg_database WHERE datname IN ('arl_local','enkyron_uat_enk03') ORDER BY datname;"
```

No SQL DDL, migration, database copy, role changes or application launch is
performed by the preflight. A failed authentication or missing CREATE DATABASE
privilege requires a separately reviewed provisioning route, not ad hoc
privilege escalation.

### Bootstrap after a fresh synthetic DB is independently confirmed

Only after a brand-new `enkyron_uat_enk03` has been created with `template0`,
owned by the current operator, and source HEAD / clean worktree have been
verified, run `npm ci --ignore-scripts` in **the #583 preview**, and then:

```bash
ENKYRON_UAT_DATABASE=enkyron_uat_enk03 \
ENKYRON_UAT_GUARD=ENK03_SYNTHETIC_ONLY \
node scripts/enkyron-enk03-uat-bootstrap.mjs --apply
```

The bootstrap performs its own exact database and owner checks, refuses
preexisting user tables, applies the original versioned migrations and creates
`public.enkyron_uat_guard` **inside the same PostgreSQL transaction**. Failure
rolls back the migration and marker together. A previous partial or complete
database is **never reset or overwritten**; investigate before rerunning.
This script is separate from the ARL service startup and does not send mail,
start assessments, create tickets or access `arl_local`.

After bootstrap, verify from the test database (read-only): migration count,
latest migration, guard marker and `current_database()`. Only then consider
launching `python3 -m desktop.enkyron` from the preview **with the same two UAT
variables exported to the full parent process**. Omission of the variables
would target `arl_local` by legacy design. The presence of a marker does
not constitute test acceptance; UAT-01 requires business-level evidence.


## Operator observation — 12 November 2026, Company 360 UAT

On the operator's isolated Debian `enkyron_uat_enk03` preview, the synthetic
company was created, and `Alex Martin` was saved and visible in its Company
360 Contacts section. **However**, `Contacts for Selected Company` on the
parent CRM pane remained stale until the operator manually clicked `Refresh`.
The operator requested automatic synchronization and one fewer button.

**Operator retest on corrected preview:** after updating to `885ae7e`, the operator confirmed the top Companies `Refresh` button is gone, **Alex Martin** remains visible, and added a second synthetic contact, **Sam Taylor**, using the **main Companies & Contacts → Add contact** form (not the in-dossier editor). Both contacts appeared in the Company 360 dossier and persisted after a manual `Refresh dossier` and close/reopen. **PASS for the main CRM contact-add path and persistence**; **in-dossier contact-save → automatic parent-pane readback remains NOT TESTED by the operator**, despite passing synthetic Qt regression. Do not overstate this as full acceptance.

**Operator opportunity check (12 November 2026, 18:12 local screenshot):** after explicit confirmation, the `ENK03 Synthetic Engineering Ltd` Company 360 dossier showed **2 contacts, 1 opportunity, 0 messages/notes, 0 commercial drafts**. The Opportunities section displayed **Stage: Research**, the previously supplied Next action on human-led AI-agent security assessment discovery, **Due: Not scheduled**, and disabled `Opportunity already recorded`. **PASS — visual confirmation of opportunity record and anti-duplicate UI**. Ticket count and absence of side effects have not yet been independently inspected in PostgreSQL, so full UAT remains open. **UI observation:** the visible `RECORDED FOLLOW-UP` panel appears empty while the Opportunities section is selected; assess its presentation separately before claiming a defect in stored action.

**Operator design requirement — single company history (12 November 2026):** The operator explicitly rejects exposing separate journals to anyone resuming a company dossier. The Company 360 UI should have **one human-readable chronological audit/history**, covering company, contact, commercial opportunity, follow-up and subsequent relevant CRM business actions with timestamp, actor, action, object, outcome, stable record ID and source provenance. Filtering by type may be offered but must not fragment the canonical view. A single visible logical timeline **does not require merging existing append-only source tables**, which should remain intact until a reviewed data-model decision; combine read-only by exact company ID and stable chronological order, and keep technical/security diagnostics out of the business timeline unless relevant. No duplicate writes, invented event history, backdating, lost audit invariants, or changes to `arl_local`. A unified read-only Company History is now implemented on this PR, while **operator desktop re-test remains pending**; the original append-only tables are preserved.

**Operator question / audit visibility gap (12 November 2026):** In the same Company 360 dossier, `CRM audit (3)` displays one company creation and two contact creations, but does not display the successfully created opportunity. **Source inspection confirms this is a read-view scope limitation:** `desktop/enkyron-crm-company-dossier.mjs` queries only `enkyron_crm_events` for `audit_events` and filters company/contact resources; the confirmed opportunity creation path inserts an append-only event separately into `enkyron_crm_opportunity_events` in the same transaction as the opportunity record. **No claim of PostgreSQL event readback is made.** UX correction: replace the three fragmented human-visible tabs with one `Company History`, including the opportunity event and other event-sourced business actions. The existing original tables remain canonical and unmodified. Do not modify this UAT's real or synthetic database as part of the observation. **UAT observation / not a data-loss finding.**

### Company History correction — implementation and acceptance scope

- **Implemented on PR #583**: one `Company History` tab (always visible), with date/time, record type, action, summary, operator, source record ID, and immutable event ID. Removed the human-facing `CRM audit`, `Field changes` and `Ticket history` navigation entries, but retained underlying source tables and existing read APIs.
- The source is `desktop/enkyron-crm-company-history.mjs`, used by the company dossier's **repeatable-read, read-only** PostgreSQL snapshot. It unifies company/contact events and versioned field edits, opportunity events, company follow-up events, manual activity/qualification metadata, prospect associations, reviewed ticket link/revocation/reassignment and permitted internal ticket metadata, mail draft revisions and **operator-reported** external send metadata. No PII-heavy notes, message bodies, review rationale or provider-send claims are fabricated. Linked opportunities/tickets must be scoped by exact company ID and current effective reviewed association; names alone never create links.
- Duplicate logical events from `enkyron_crm_events` (`updated` and `linked`) are suppressed when their more precise immutable source rows are already represented.
- **Readable story & pagination:** within the same Company 360 dossier, `Company History` now shows expandable event cards with selectable **Oldest first (default)** and **Newest first**. The first chronological event is card 1 by default; date, operator and full recorded summary/source IDs are readable without hover. Records are served in bounded 20-event pages with Previous/Next controls, using an exact-company, read-only IPC route. The original fixed 180-character truncation of commercial action text was removed. **Known limit:** the business-history union does not yet cover every downstream document/invoice lifecycle record, and source metadata cannot reconstruct message/note bodies that were not recorded in that event; describe recorded metadata accurately. No source logs are rewritten.
- GitHub native Qt regression, unit tests and disposable CI PostgreSQL must pass at exact HEAD. **Human UAT remains open:** the operator must install the exact verified SHA in the isolated #583 preview, confirm chronological story order **Company → Alex Martin → Sam Taylor → Opportunity**, click to expand a full summary, toggle to reverse order and back, and verify company/contact/opportunity records persist. Do not change `arl_local` or rerun 113 migrations. Resume UAT-01 company follow-up creation afterwards.

Correction in this PR: after an acknowledged dossier contact creation or
correction, re-read contacts for the **exact selected company ID** in the main
pane; on entering the CRM module, automatically reload the company list once.
Remove the top Companies `Refresh` button, preserving readback and stale
callback guards. Native synthetic Qt regression added. **This remains a
fix awaiting local operator re-test, not a UAT pass.** Do not duplicate the
existing synthetic contact. Closing with the window X and clicking Close use
the same dossier unsaved-work guard.

## Acceptance scenario UAT-01 (after test workspace isolation is proven)

1. Open the PR #583 native ENKYRON preview and select **CRM → Companies & Contacts**. Create one clearly synthetic company, e.g. `ENK03-UAT Synthetic Company`; confirm it is selected by canonical company ID, not a matching name.
2. Open the same Company 360 dossier and, from **Contacts**, create one synthetic contact. Confirm the contact appears automatically both in the dossier and in **Contacts for Selected Company** on the parent Companies pane, with **no manual Refresh**. An observed 12 November UAT-01 defect required the operator to click Refresh; a targeted fix is committed but requires local re-test.
3. In the same dossier, select **Opportunities → New opportunity**, enter a specific next action, review the displayed company, and explicitly confirm. A refusal/cancel must perform **no write**.
4. After confirmation, the UI must show an acknowledgement first, then show **verified** only after the returned opportunity ID is visible in the reloaded canonical company dossier. If readback fails or the item is absent, it must remain **unverified** and advise investigation rather than another blind creation.
5. Verify the new opportunity appears as an actual company-linked record. Attempting a second direct company opportunity must not create a duplicate; a visible existing company-only opportunity disables the button, and the service rejects duplicates independently.
6. From **Company follow-ups**, create one dated synthetic company-owned reminder using the existing confirmed service. This is a scheduled local reminder, **not** a sent email or proof of customer interest.
7. Close and reopen the dossier, then confirm the same company ID, contact, opportunity, next action and company-owned reminder persist **without manual Refresh**. Navigate Home → CRM and verify no silent selection change.
8. Inspect the synthetic test data and ticket count before/after: **zero implicit service tickets, mail sends, contracts, invoices or assessments**. Confirm records belong only to the intended local test workspace.
9. Check negative paths: cancel at the confirmation step, stale/failed readback, refresh during an outstanding write, change of selected company, and failed backend permissions. A partial or failed operation must not be displayed as verified.

## Recording evidence and the human gate

Record for each step: date/time, isolated test database name, app branch + exact SHA, synthetic company/opportunity identifiers (not customer data), screenshot or sanitized trace, expected vs observed behaviour, and the operator's verdict `PASS`, `FAIL`, or `BLOCKED`.

**UAT-01 is IN PROGRESS, not accepted.** CI success, source inspection and synthetic Qt fixtures cannot close it. Keep PR #583 draft and ENK-03 `PARTIEL` until verified UAT and an explicit human decision. Multioperator authentication/authorization remains a separate unresolved platform gate.

**Next step:** run the auto-refresh regression on exact-head CI, then update only the #583 preview once the operator closes ENKYRON; verify the already saved Alex Martin remains visible and test a confirmed synthetic contact edit without manual Refresh. Do not re-bootstrap or reset the isolated DB.

## Operator checkpoint — 12 November 2026, ENK-03 steps 4–7

Observed in the separately guarded Debian UAT database `enkyron_uat_enk03`
with `ENK03_SYNTHETIC_ONLY`. These are **operator-visible UAT observations**,
not independent PostgreSQL audit results or approval to merge:

- `ENK03 Synthetic Engineering Ltd` displays two distinct contacts
  (`Alex Martin`, `Sam Taylor`) and one company-linked opportunity.
- A single company-owned manual follow-up was created for 2026-11-19
  (revision 1), rescheduled to 2026-11-20 (revision 2), then completed
  (revision 3). The UI continued to show one follow-up, not a duplicate.
- The Company History count progressed from five through seven after
  rescheduling/completion. The completion event was visible with operator
  `emprex` and a stable follow-up record ID.
- Company sector correction to `Synthetic engineering services`
  was saved; history progressed to eight events.
- Contact `Sam Taylor` was corrected from `Project Manager` to
  `Senior Project Manager`. The new role was read back from the Contacts
  view and Company History showed nine events with a contact
  `job_title` update. Contact count stayed at two.
- Two **presentation-only issues** were found after successful writes:
  company and contact field corrections both rendered as
  `Company Contact Change`; and after the company follow-up was completed
  the headline still displayed the separate opportunity's next action
  under `RECORDED FOLLOW-UP`. The PR now distinguishes source kinds and
  opportunity action vs open company follow-ups; **Debian operator
  re-test on the corrected exact SHA remains pending**.

**Still required before UAT-01 acceptance:** independent read-only inspection
of the synthetic PostgreSQL records/side-effect counts, no implicit ticket,
mail, invoice, contract or assessment creation; negative-path verification;
confirmation of the latest presentation fixes on Debian; and an explicit
human acceptance decision. Do not reset the existing test database or
re-run the 113 migrations. PR #583 remains draft/not merged.

## Operator checkpoint — 12 November 2026, ENK-03 step 8 read-only SQL

**Operator-supplied Debian terminal output and screenshot, exact preview
update target** `119d229cb0f50de80a207f82e0af4f48d6155ae1`.
The available screenshot confirms the corrected `NEXT ACTION` banner states
`No open company follow-ups` and separately identifies the opportunity's
next action; Company History still has nine events and its visible company
revision card says `Company · Updated`. The preceding expanded contact
revision retains `contact fields: job_title`. The screenshot does not
fully show that contact card's heading, so do not claim independent visible
proof of its title.

**Read-only PostgreSQL transaction reported by operator:**
- `current_database() = enkyron_uat_enk03`,
  `current_user = emprex`.
- Exact local-workspace company `ENK03 Synthetic Engineering Ltd` with
  sector `Synthetic engineering services`: 2 contacts, 1 directly
  linked opportunity, 1 company-owned follow-up.
- Follow-up: `completed`, version 3, due `2026-11-20`,
  3 recorded follow-up event revisions.
- In this isolated test database, six table-level counts were all zero:
  `arl_workbench_tickets`, `enkyron_crm_mail_manual_sends`,
  `enkyron_crm_mail_drafts`, `enkyron_crm_contract_references`,
  `enkyron_crm_issued_invoices`, `owner_assessment_cases`.
  These counts prove only the present stored rows in these six tables.
  They do not independently demonstrate no external transmission nor
  every negative/guard path.
- Transaction ended with `COMMIT`, but ran under `BEGIN READ ONLY`,
  and does not evidence any new database mutation.
- A Qt device-pixel-ratio cache warning appeared at launch; the app
  opened and displayed the company dossier, so no reproducible functional
  failure is established from this warning alone.

**Acceptance:** step 8 positive read-back/PgSQL checks PASS for the
observed assertions. UAT-01 remains IN PROGRESS, not human accepted;
negative UI/server denial tests and end-to-end operator acceptance remain.
PR #583 stays draft; no merge or production DB writes.

## Operator checkpoint — step 9–12, 12 November 2026

**Build under Debian UAT:** `e2a2353152cec93f8745d5d052a15df2917c44be`
of PR #583 in the isolated `~/enkyron-ux-preview-583` checkout;
`ENKYRON_UAT_DATABASE=enkyron_uat_enk03` and
`ENKYRON_UAT_GUARD=ENK03_SYNTHETIC_ONLY`.
Operator-reported screenshots and terminal evidence are the primary manual
UAT observations, not direct database access by this reviewer.

- **9A PASS (UI):** Existing follow-up is `completed`, revision 3,
  due 2026-11-20; `Reschedule / edit`, `Mark completed` and
  `Cancel follow-up` remain disabled despite checked confirmation.
  `Add follow-up` remains available for creating a distinct reminder.
- **9B PASS (UI):** The sole company-only opportunity remains at
  `Research`; duplicate creation is disabled, and the history remains
  at nine entries. A clipped disabled `Opportunity already recorded`
  label was corrected on exact SHA `e2a2353`; the operator confirmed
  the whole label can now be read.
- **10A PASS (UI):** A synthetic action draft was cancelled without
  saving; original next-action text and nine history entries were
  observed after a dossier refresh.
- **10B PASS (UI):** Closing a dossier with an unsaved edited next action
  displayed `Discard unsaved work?`, with `No`/`Yes` actions.
  Operator subsequently confirmed cancellation and return to the
  original text. Screenshot demonstrates guard prompt, not server audit.
- **10C PASS (targeted guard test):** Operator terminal printed seven
  blocks and `ENK-03 STEP 10C: PASS`: `mail-send-draft`,
  `create-ticket`, `assessment-link`, `crm-invoice-issue`,
  `crm-update-opportunity`, `crm-mail-manual-send` through the
  UAT command predicate; `crm-prospects` refused via local IPC.
  The six sensitive commands were **not actually dispatched through
  IPC**. This is not a general authorization/security penetration test.
- **11 PASS (visual persistence):** After restarting the guarded
  application, without manual refresh, the same company and
  `Synthetic engineering services` sector, two contacts
  (Sam Taylor `Senior Project Manager`, Alex Martin `Technical
  Director`), one opportunity, zero tickets, nine history items
  and `No open company follow-ups` were visible. The earlier
  read-only SQL check independently showed one `completed` follow-up,
  version 3 and three events.

**Exact GitHub HEAD before documentation-only checkpoint:**
`e2a2353152cec93f8745d5d052a15df2917c44be`.
ENKYRON Desktop run `43299199254` SUCCESS; CI run `43299199247`
SUCCESS, including PostgreSQL integration. Automated native tests cover
a refused opportunity confirmation, incomplete readback staying
unverified, and in-flight close guards. Automated tests are not a
substitute for unexecuted human fault injection.

**Step 12 — evidence consolidated, human acceptance pending.**
Remaining limits: stale/failed readback and switching selected company
during a pending write have not been completely exercised by the
operator on Debian; the six sensitive commands were predicate-only
denial checks; full security, multi-user authorization and production
readiness are outside this UAT. No production `arl_local` database
write, data migration, merge or release is authorized by this report.

**Disposition: ENK-03 UAT positive business flow PASSED; full UAT-01
acceptance remains PENDING explicit human decision / documented
disposition of residual checks. PR #583 remains DRAFT, unmerged.**
