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
