# ENKYRON — Native Workstation UX Architecture and Phase-0 Baseline

**Date:** 2026-11-12  
**Scope:** ENKYRON desktop business-operations experience; KYRTHOS assessment development is paused.  
**Status:** Reviewed GitHub source inventory and proposed design; **not** a Debian operator acceptance or a database certification.  
**Canonical repo:** \`emprex/agent-risk-layer\`.

## 1. Verified GitHub baseline and change isolation

- \`main\`: \`1b0c9bb1d7d1cc1827b11d83c0be647757aebcf2\` on 2026-11-12. \`desktop/enkyron.py\` is **not** in the \`main\` desktop tree.
- Existing native work: draft PR **#564**, \`fix/enkyron-ux-pilot-workflow-20261111\`, SHA \`c6aac9054fc7dc5499164c8b3b99e4db89587930\`. This is the **UX foundation for this small isolated change**.
- Assessment-related draft stack: PRs **#575 → #576 → #577 → #578** (and upstream dependencies). #578 SHA when inspected: \`f20e234610c7fbfb31ebf6f5a8eda21aa1c16aa7\`; it is a descendant of #564. Do not alter, merge or discard this stack for the workstation UX change.
- At #578, \`desktop/enkyron.py\` has **17,617 lines**; its primary Qt classes are \`GuardedCompanyWindow\`, \`DesktopBridge\`, \`DetachableModuleWindow\` and \`EnkyronWindow\`. This is a maintainability risk, not grounds for a one-shot rewrite.
- The desktop already uses Qt6/PySide6, local Node IPC in \`desktop/enkyron-bridge.mjs\`, existing PostgreSQL models, native dialogs and real Mail/Calendar pages.
- Migration files \`063\` through \`113\` exist on the #564 development branch; #578 additionally contains \`114\`. **Which migrations have been applied on the operator's Debian database is unverified here.** No database access or migration is required by this change.
- Source of truth for identities, authority and data: backend and PostgreSQL, **never** UI labels, hidden buttons or LLM decisions.

### Existing code anchors to preserve

| Concern | Source |
| --- | --- |
| Native shell, navigation, ticket pages, CRM tabs, Home | \`desktop/enkyron.py\` |
| Native Mail inbox and calendar | \`desktop/enkyron_mail_workspace.py\`, \`desktop/enkyron_calendar_view.py\` |
| IPC command routing, read/write separation | \`desktop/enkyron-bridge.mjs\` |
| CRM entities, opportunities, drafts, links, billing | \`desktop/enkyron-crm*.mjs\` |
| Mail transport and archives | \`desktop/enkyron-mail-*.mjs\` |
| Access checks | \`desktop/enkyron-access-policy.mjs\`, owner/session services |
| Persisted models and append-only changes | \`migrations/063_*.sql\` through \`113_*.sql\` (development history) |
| Native offline acceptance pattern | \`tests/qt_enkyron_local_office_smoke.py\`, \`tests/enkyron-desktop.test.js\` |
| Existing operator UX bug and fix | issue #563, draft PR #564 |
| Business operation scope | \`docs/ENKYRON_PSA_ROADMAP.md\`, 17 blocks / 157 historical criteria |

## 2. Product boundary and operator promise

ENKYRON is a **professional services automation (PSA), CRM, Service Desk and cybersecurity-operations desktop**, not a standalone CRM and not simply KYRTHOS's GUI.

- **ENKYRON:** navigable work and human actions.
- **NEMORYTH:** current business records, permissions, correspondence, evidence and history (existing PostgreSQL).
- **EIRYON:** proposed contextual AI assistance, never an autonomous source of human authority.
- **KYRTHOS:** specialised, human-controlled security assessment; paused.

Design question: **"What do I need to do next, for which customer, using which existing record, and what happened?"**

Do not invent an entity or a status to fill a widget. In particular, a prospect is not a support ticket; a draft is not an issued invoice; an email association is not a ticket creation; a synthetically passing test is not a finding decision.

## 3. Capability map (source-level; no implied production acceptance)

| Area | GitHub evidence | Current classification |
| --- | --- | --- |
| Tickets | list, details, notes, history, assignment, triage/actions | Code present; end-to-end operator gate open |
| Companies/contacts | real CRM tables, links, review and dossier views | Code present; full reconciliation and access gate open |
| Prospects/sales | research, opportunities, pipeline, follow-ups | Code present; commercial conversion gate open |
| Mail | native inbox, local archive, drafts, provider service | Partial; live account/send/attachments rights unverified |
| Calendar | native appointments and local tasks | Code present; multiuser calendar unverified |
| Proposals/SOW | draft versions, source links, documentary reviews, PDF drafts | Code present; contractual execution not proven |
| Finance | billing worksheets, invoice drafts, issuance/payment modules | Partial; real accounting/tax acceptance unverified |
| Projects/operations | no independently verified full native project-delivery workflow | Not demonstrated |
| Knowledge/NEMORYTH | linked DB, dossier and evidence metadata retrieval | Foundations present; global authorised search unverified |
| EIRYON | working vision and some existing ARL assistance elsewhere | Native workstation integration not demonstrated |
| Administration | operator profile, identity registry, sessions, access policy | Components present; multiuser tenant isolation not proven |
| KYRTHOS | assessment panels, control/evidence tooling | Preserved, paused |

These classifications must be revised from exact branch and later Debian evidence; presence of a module or green CI does not mean "DONE-LOCAL".

## 4. Target information architecture — progressively delivered

The final primary destinations, subject to demonstrated backend permissions, are:

1. **Home / My Work:** prioritised work, appointments, actionable follow-ups; one clear next step, no invented priority scores.
2. **Clients & CRM:** companies, contacts, prospects, opportunities, relationship history.
3. **Service Desk:** tickets, incidents, request queues, assignment/escalation L1–L5.
4. **Communications:** Mail, calendar, conversation/entity linking and reminders.
5. **Commercial & Finance:** proposals, quotations, SOW, contractual references, invoice lifecycle.
6. **Projects & Operations:** project scope, task ownership, time, delivery and validation.
7. **Knowledge & AI:** authorised NEMORYTH lookup and bounded EIRYON assistance.
8. **Administration:** users, company, workspaces, integrations, access policy and audit.
9. **Security assessments** as a specialist entry when KYRTHOS development resumes.

**Do not replace today's five working navigation entries with dead-end tabs.** Add functional destinations only once a user can complete the relevant job. During transition, preserve the original page objects, lazy loaders, detaching behaviour and context identifiers; prefer route helpers over copying content.

### Consistent record layout

Every business record should expose: **header/identity → current state → one primary next action → relevant people/docs → timeline → advanced provenance**. Empty sections should collapse, especially in ticket notes (#563). Errors must say what the user can recover, without leaking sensitive backend details. Keyboard focus and the laptop's minimum viewport are acceptance requirements.

## 5. Existing-to-target task journeys

| Journey | Present native anchors | Required A→Z acceptance |
| --- | --- | --- |
| Commercial | CRM company/contact, research, pipeline, proposal, billing drafts | Lead → company/contact → opportunity → quote/SOW → signed agreement → project → deliverable → invoice → payment, preserving relations |
| Support | Client Desk ticket, work notes, triage and actions | Request → verify customer → ticket → priority → owner → action → resolution → notification → close → history |
| Communications | native Mail, CRM link, local archive, Calendar | Receive → inspect → explicitly link correct entity → respond/forward after approval → archive → recover/search |
| Projects | company dossier/task/calendar fragments | Project → scope → team → tasks → execution → deliverable → client approval → billing (not yet demonstrated) |
| Finance | quote, tax review, billing worksheet, invoice registers | Approved quote → prebilling → checked invoice → authorised issue → send → reconcile payment → immutable trace (not yet demonstrated) |
| Security | existing specialist tabs and ARL engine | **Paused**; preserve verified historical state, access controls and evidence lineage |

## 6. Prioritised 17-block delivery order

Historical IDs remain the source numbering; sequence below reflects operator dependency, not percentage completion.

| Wave | Blocks | Gate to proceed |
| --- | --- | --- |
| **Foundation — P0** | 00 users/identity/access, 10 NEMORYTH integrity | Human/technical account boundary, scoped reads/writes, audit, backup and isolation designs proven before multiuser rollout |
| **Workstation — P1** | 14 Home/reporting, 02 CRM, 01 tickets, 03 Service Desk | Open any exact record; show state, action and timeline; no ambiguous cross-links |
| **Communications — P1** | 04 Mail, 06 Calendar, 05 Website intake | Provider verification and consent; attachment handling; deliberate routing without auto-ticket generation |
| **Delivery — P1** | 07 commercial/contract, 08 projects, 09 time/finance | One approved sales-to-payment path, source documents/approvals and recovery verified |
| **Assist — P2** | 12 EIRYON, 15 integrations | Per-action permissions, external-action confirmation, audit and no parallel authority |
| **Expand — P2** | 13 client portal, 16 multi-company product | Tenant isolation and independent roles proven with negative cases |
| **Preserve — paused** | 11 KYRTHOS | No new assessment work until explicit reprioritisation |

All 157 historical acceptance criteria must be individually reconciled against their source records before anyone claims completion percentages.

## 7. First bounded implementation: UX-FOUNDATION-01, Home / My Work

**User problem:** Home has only direct buttons for Tickets and Mail, while CRM and Calendar require the operator to find the sidebar. The welcome text emphasises internal technology instead of today's tasks.

**Design choice:** Keep the same four functioning destinations and the same Qt \`QStackedWidget\`/CRM selection. Present a compact, keyboard-accessible two-row "Start working" area with shortcuts to **Tickets, Clients & CRM, Mail, and Calendar**. Give each control a stable object name and accessible minimum height. Keep existing opportunity/company follow-ups and their real counts. No new system state or data source.

**Invariants:**
- Clicking a shortcut opens exactly the existing module. Mail must keep its current internal tab selection; Calendar must keep its own page; Tickets and CRM must not be conflated.
- No new network/DB/financial operation is triggered by a shortcut beyond that destination's existing read-only load. No synthetic counts or automatic contact/ticket creation.
- No new tables, migrations, roles, backend operations, agents or permissions.
- No changes to assessment, pilot, evidence, master or findings.

**Tests:**
1. Native Qt offscreen fixture stubs the bridge and clicks all four buttons.
2. Assert the actual \`navigation.currentRow()\` and \`pages.currentIndex()\` for each; verify Mail's existing CRM-tab routing.
3. Confirm existing four-page stack and five-entry nav remain unchanged.
4. Verify that shortcut activation never invokes any mutating IPC action in the fixture.
5. Run the existing ENKYRON Desktop CI on the **exact final commit**.
6. Require a Debian operator screenshot and click-through before marking **DONE-LOCAL**.

**Rollback:** revert the isolated shell diff; no SQL or record transformation. Work is a **draft** until CI, diff review and operator acceptance.

## 8. Follow-up sequence after UX-FOUNDATION-01

- **UX-FOUNDATION-02:** inspect the fully visible Company 360 and ticket record against the same header/action/history layout without reopening #563 work.
- **UX-WORKFLOW-01:** validate the full human commercial path with synthetic records and identify the **first** nonfunctional step. Correct that step only.
- **UX-COMM-01:** verify mail provider state, message/attachment provenance, and entity association before exposing new external actions.
- **SEC-ACCESS-01:** prove backend role and workspace denial before any second employee or customer access.

No fixed delivery date, product-completion claim, additional data migration or KYRTHOS restart is implied.