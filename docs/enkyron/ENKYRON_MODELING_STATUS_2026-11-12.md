# ENKYRON — Modeling / Architecture / UX status

**Date:** 12 November 2026  
**Evidence level:** source-checked + limited operator screenshots, not full platform UAT  
**Authority:** `ENK-PLAN-001 v1.0` (12 Nov 2026); `docs/ENKYRON_PSA_ROADMAP.md` retained separately as the historical 17-block/157-criterion reference.  
**Draft PR stack:** [#564](https://github.com/emprex/agent-risk-layer/pull/564) → [#579](https://github.com/emprex/agent-risk-layer/pull/579) → [#580](https://github.com/emprex/agent-risk-layer/pull/580) → [#581](https://github.com/emprex/agent-risk-layer/pull/581); no merge to `main`. Separate KYRTHOS pilot draft stack ends in [#578](https://github.com/emprex/agent-risk-layer/pull/578); remains paused.

## 1. What is actually verified

| Area | Status | Evidence | Limitation |
| --- | --- | --- | --- |
| ENK-00 baseline source inventory | **PARTIEL** | Three files under `docs/enkyron/`, bridge/UI/migration audit | Not every view and permission proven on Debian; backup restoration not exercised |
| PostgreSQL source/schema | **PARTIEL** | Operator read-only output: 115 registered migrations, 114 files, 0 checksum mismatches; orphan historical `021_paid_assessment_remediation_scope.sql` traced to its 20 Aug 2026 add/removal commits | Only nominated tables and foreign keys inspected; no runtime permission/backup recovery proof |
| ENK-01 screen model | **PARTIEL** | `ENKYRON_COMPANY_360_UX_SPEC.md`, screenshots of real native Company dossier | Full end-to-end CRM journey not accepted |
| ENK-01A company follow-up card | **VISUAL_ACCEPTED (scope only)** | Operator's Debian screenshot: `RECORDED FOLLOW-UP` panel and existing follow-ups action together; [PR #580](https://github.com/emprex/agent-risk-layer/pull/580) CI green on `32a2edc3c41e06626ec2aba393baddfb139a632d` | No evidence yet of editing/creating a follow-up in this preview; keep draft |
| ENK-01B Home status & labels | **VISUAL_ACCEPTED (scope only)** | Operator's Debian screenshot 15:34 local: literal `Clients & CRM`, literal `appointments & tasks`, clear no-follow-ups state; [PR #581](https://github.com/emprex/agent-risk-layer/pull/581), workflows green on `9606c90a649e40b6518d029e4892c502830c279e` | Home buttons not all manually clicked in this screenshot; no full small-screen/keyboard test |
| Navigation shell ENK-02 | **PARTIEL / NEXT** | Existing Home/Tickets/CRM/Mail/Calendar QStackedWidget; some route tests in Qt CI | Dossier context across modules, back navigation and error recovery not proved |
| CRM E2E ENK-03/04 and UAT-01 | **NOT_RUN** | Existing models/actions in Node/Qt; real company/contact/opportunity relationships seen/read-only | Not yet executed as a complete synthetic human flow with re-read after writes |
| Security / access control | **BLOQUE FOR MULTIUSER** | `desktop/enkyron-access-policy.mjs` explicitly documents policy-only contract without service-side enforcement | Do not claim team-ready RBAC or cross-tenant isolation |
| KYRTHOS new assessment work | **SUSPENDU** | Explicit plan | Preserve historical branches, assessment snapshots, data |

**Distinction:** `ENK-00`–`ENK-15` are plan **execution stages** (§7); `ENK-B00`–`ENK-B16` are **17 product domains** (§6). These are not the same numbers or a completion percentage. Historical “157 criteria” have not been individually reconciled and must not be represented as passed.

## 2. Target architecture and how far it is built

```text
ENKYRON / native PySide6 — daily work experience
  ├── My Work                       usable on Debian, layout acceptance limited
  ├── Clients & Sales               code present; first Company 360 UX increment accepted
  ├── Service Desk                  code present, complete workflow not accepted
  ├── Communications               mail/calendar code present, links not fully accepted
  ├── Projects                      end-to-end project service unproven
  ├── Finance                       proposals/invoices/payments code, E2E unproven
  └── Knowledge & AI                EIRYON complete integration unproven
            │ bounded IPC
            ▼
Node domain services + PostgreSQL (NEMORYTH)
  ├── canonical companies, contacts, opportunities, follow-ups, tickets
  ├── communications, financial records, history, audits
  └── user identities/session primitives — full enforcement unproven

KYRTHOS: specialized deterministic ARL engine (preserve; development paused)
EIRYON: future assistance, not human decision authority
```

## 3. 17 product domains: conservative status from available evidence

| Domain | State at this checkpoint |
| --- | --- |
| B00 Foundations / identity / permission / backup | PARTIEL; multiuser isolation unverified |
| B01 Tickets | CODE_PRESENT_NON_RECETTE |
| B02 CRM | PARTIEL; Company dossier visible, UAT-01 missing |
| B03 Service Desk L1–L5 | PARTIEL / authority not proven |
| B04 Mail | CODE_PRESENT_NON_RECETTE |
| B05 Web request intake | INCONNU / full provider path not demonstrated |
| B06 Calendar | CODE_PRESENT_NON_RECETTE |
| B07 Sales / SOW / contracts | CODE_PRESENT_NON_RECETTE |
| B08 Projects & operations | INCONNU / E2E not demonstrated |
| B09 Time & finance | PARTIEL, invoice code present; E2E not demonstrated |
| B10 NEMORYTH | PARTIEL PostgreSQL and evidence stores; transverse UX not demonstrated |
| B11 KYRTHOS | SUSPENDU |
| B12 EIRYON | INCONNU / complete integration not demonstrated |
| B13 Client portal | NON_IMPLEMENTE as accepted product (evidence not demonstrated) |
| B14 Reporting | PARTIEL, initial Home metrics visible |
| B15 Integrations & API | PARTIEL, provider contracts to be verified |
| B16 Multi-company product | NON_IMPLEMENTE as accepted product |

These are **qualitative evidence states**, not user-story completion measurements.

## 4. Next executable tranche: ENK-02 → ENK-03 → ENK-04

**ENK-02, first navigation acceptance, scoped to read-only movement:**
- Open one **existing** Company 360, note the selected company identity (internally, never write it to GitHub).
- Close the Company dossier; navigate **Home → CRM → Companies & Contacts**; verify whether the same company selection is preserved.
- Open that same dossier; verify canonical identity and section selection. Visit **Mail** and return; verify whether an active company context is retained, reset deliberately or silently lost.
- On a synthetic error, ensure loading/error cannot be mistaken for an empty successful result.
- Keep existing object identifiers; do not introduce a new global company-selection model without a failing reproduction and a precise contract.
- Record UX acceptance: actual steps and states before/after, no business writes. Full `ENK-02` remains open until small-screen and keyboard tests.

**ENK-03/04, first complete business journey UAT-01:**
- With explicit approval, **synthetic test data and verified backup**, create a company → contact → opportunity → company-owned follow-up; close/reopen and read the precise existing records. No implicit ticket creation; avoid contact/record deduplication by name alone.
- Confirm back-end identity and permission gates before the first real multioperator use.
- Add Node/DB and Qt tests only for the concrete failing step; preserve a draft PR and KYRTHOS.

**Safety invariant:** no changes to actual customer records, mailbox sends, invoice issuance, migration or ARL assessment work for this checkpoint.

### Source-level ENK-02 finding (read-only audit; no fix yet)

In `desktop/enkyron.py`, `module_changed(index)` enters CRM through the existing page and sets the CRM tab to index 0; when `crm_company_loaded` is true it does **not** automatically call `load_companies`. The selected company may therefore survive ordinary module switches; **a navigation defect is not proven from this alone**.

However, the `load_companies()` callback currently clears `crm_company_id` and the selected-company controls before repopulating the list. It restores selection **only** when `crm_pending_company_id` has been populated by another explicit workflow. An ordinary user-driven refresh with that field unset is a credible context-loss case, **visible in code but not yet reproduced in UAT**. The first ENK-02 regression should simulate: select company A → refresh same list → verify exact company A remains selected if returned by the canonical list, or a clear reset if missing/unauthorized. Test the race between pending searches and refreshes, and never silently select a different company.

No code change is justified until this behavior is reproduced under a Qt stub and its intended UX semantics are agreed. Preserve history, current company identity, and the existing guard against unsaved dossier edits.

## 5. Screenshots and privacy

Operator screenshots are available in the ongoing conversation but **not committed to public GitHub**, because they include customer records and personal details. The accepted visible features are recorded here without customer-identifying data. A screenshot alone cannot prove buttons work, records persist or roles are enforced.

## 6. Milestone gates (ENK-PLAN-001 §5)

| Gate | Checkpoint |
| --- | --- |
| G0 Baseline | PARTIEL: migration history mapped, restore not tested |
| G1 UX model | PARTIEL: CRM and Home designed, remaining five pilot routes to validate |
| G2 Shell | PARTIEL: visual changes verified, context/return/keyboard not validated |
| G3 First business journey | NOT_RUN: UAT-01 synthetic write/read not executed |
| G4 Business workspaces | NOT_RUN at required full E2E level |
| G5 Platform identity/integration | PARTIEL / MULTIUSER BLOCKED |
| G6 Product | NOT_RUN / not market-ready by this gate |

**Next source-level action:** inspect `desktop/enkyron.py` CRM selection/current company callbacks and isolate one reproducible context-loss case, then create **one** scoped test/fix PR if a fault is confirmed; do not create another full refactor.
