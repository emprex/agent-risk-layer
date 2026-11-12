# ENK-03 — UAT-01, Company 360 native workflow

**Status:** PREPARED / NOT EXECUTED ON OPERATOR DEBIAN  
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

## Acceptance scenario UAT-01 (after test workspace isolation is proven)

1. Open the PR #583 native ENKYRON preview and select **CRM → Companies & Contacts**. Create one clearly synthetic company, e.g. `ENK03-UAT Synthetic Company`; confirm it is selected by canonical company ID, not a matching name.
2. Open the same Company 360 dossier and, from **Contacts**, create one synthetic contact. Confirm the contact appears under the selected company after Refresh.
3. In the same dossier, select **Opportunities → New opportunity**, enter a specific next action, review the displayed company, and explicitly confirm. A refusal/cancel must perform **no write**.
4. After confirmation, the UI must show an acknowledgement first, then show **verified** only after the returned opportunity ID is visible in the reloaded canonical company dossier. If readback fails or the item is absent, it must remain **unverified** and advise investigation rather than another blind creation.
5. Verify the new opportunity appears as an actual company-linked record. Attempting a second direct company opportunity must not create a duplicate; a visible existing company-only opportunity disables the button, and the service rejects duplicates independently.
6. From **Company follow-ups**, create one dated synthetic company-owned reminder using the existing confirmed service. This is a scheduled local reminder, **not** a sent email or proof of customer interest.
7. Close and reopen the dossier, Refresh, then confirm the same company ID, contact, opportunity, next action and company-owned reminder persist. Navigate Home → CRM and verify no silent selection change.
8. Inspect the synthetic test data and ticket count before/after: **zero implicit service tickets, mail sends, contracts, invoices or assessments**. Confirm records belong only to the intended local test workspace.
9. Check negative paths: cancel at the confirmation step, stale/failed readback, refresh during an outstanding write, change of selected company, and failed backend permissions. A partial or failed operation must not be displayed as verified.

## Recording evidence and the human gate

Record for each step: date/time, isolated test database name, app branch + exact SHA, synthetic company/opportunity identifiers (not customer data), screenshot or sanitized trace, expected vs observed behaviour, and the operator's verdict `PASS`, `FAIL`, or `BLOCKED`.

**UAT-01 remains NOT RUN until the operator actually performs these steps.** CI success, source inspection and synthetic Qt fixtures cannot close it. Keep PR #583 draft and ENK-03 `PARTIEL` until verified UAT and an explicit human decision. Multioperator authentication/authorization remains a separate unresolved platform gate.

**Next step right now:** execute only the read-only preflight, capture the output, then prepare the isolated preview and synthetic DB without disrupting the local KYRTHOS pilot.
