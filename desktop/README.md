# ENKYRON — Native desktop prototype (Debian)

ENKYRON is the **Qt 6 / PySide6 desktop frontend** for AgentRiskLayer. It is not a website, an Electron app, or an HTML wrapper.

## One platform — working component names

**AgentRiskLayer (ARL)** is the single platform and parent brand, maintained in the canonical `emprex/agent-risk-layer` repository. These are **working product labels**, not separate apps, databases or legal trademarks:

| Name | Role |
| --- | --- |
| **ENKYRON** | Native desktop operator |
| **KYRTHOS** | Existing deterministic ARL assessment/control/testing authority |
| **EIRYON** | Planned AI-assisted coordination/orchestration; never the security authority |
| **NEMORYTH** | Existing PostgreSQL knowledge, control and evidence store |

The names do **not** justify new engines, repositories or schemas. Reuse tested ARL modules and retain human decision gates. Trademark clearance remains outstanding.

## Product priority: the client and operations environment

ENKYRON is first a **single native business operations workspace**, not an assessment viewer. The operator can receive client requests, manage tickets, record communications, coordinate work and later call KYRTHOS (the existing ARL engine) or EIRYON (AI orchestration) only through controlled actions. NEMORYTH remains the authoritative local PostgreSQL store. Security assessment capabilities are secondary tabs, not the product's primary navigation.

**Implemented Client Desk increment:** Create a ticket from a telephone call or manual request without any ARL assessment, target repo, master, or schema migration; store client/contact/phone/email/request text in the existing ticket's scope field, mark the origin `intake:phone` or `intake:manual`, issue the existing ARL ticket number and record the event. Update status through the same permitted transitions as the existing Workbench. Existing notes and history remain accessible.

**Not connected yet:** real webmail/IMAP or website intake. External messages must arrive through a dedicated, authenticated and rate-limited ingestion boundary with provider verification, deduplication, spam handling, attachment quarantine and operator review. They cannot call the local database or assessment engine directly. The local GUI currently accepts only operator-attested `phone` and `manual` sources; do not label a manual entry as provider-verified email or website intake. Contact information is retained in the ticket's internal scope text as an interim representation, not a full CRM/contact model. Customer-data retention, roles and encryption need separate acceptance before real external onboarding.

**Next sequence:** native ticket acceptance on Debian → status / contact management → inbox adapters → two-way communications → bounded EIRYON assistance → consolidated client/mission dashboard, preserving the existing KYRTHOS security engine.

## First implemented operator workflow

- View and search the first 100 existing PostgreSQL tickets (search narrows results).
- Open a **New ticket** native dialog for a telephone call or manual request; update permitted ticket statuses and record their audit events. No assessment is created.
- Open an existing ticket and inspect scope, target, assessment binding, notes and activity.
- Read the latest linked master dossier **only after SHA-256 integrity and project / assessment / snapshot / target binding checks**.
- Append manual work notes to the existing ticket, recording an append-only ticket event.
- Closed tickets cannot receive new notes. No security decision or test is ever triggered.
- Open the native **ARL Engine** tab and request a read-only inspection using the **existing** Python Operator `assessment_bridge.inspect_existing`, which delegates to the canonical Node ARL command. ENKYRON first validates the master and requires the latest snapshot to be current; the existing reader must confirm the identical project, assessment, snapshot and frozen target SHA. No assessment is created if missing.
- Open the native **Evidence Requests** tab to read ARL's authoritative **108-control workplan**, select a requirement pack and inspect up to 20 requirements per page. This reuses `evidence_bridge.load_evidence_workplan` and `evidence_pack_bridge.read_evidence_pack`. All results are requests/candidates only: **no proof accepted, no tests run, no PASS/FAIL inferred**.
- Use the native **Evidence Register** tab to inspect stored metadata (maximum 100 rows) for any of `ARL-KB-001`–`ARL-KB-108`. Reads only `control_evidence_items` for the **verified current master project and snapshot**, in the same read-only PostgreSQL transaction. Shows recorded verification/retention status, source type, stored digest, observed time, test/runtime/approval links; **never** raw evidence, descriptor JSON or source references. The same read-only transaction also retrieves **up to 100 test execution metadata records** for that exact control and snapshot. The UI presents separate evidence/test lists, recorded test results, retest/finding lineage and a human-review **checklist (not saved or approved)**. A stored digest is **not** an independently checked integrity claim, and a test result `passed` is **not** an ARL control PASS.

The Python Qt process talks to `desktop/enkyron-bridge.mjs` through one-shot JSON messages over local process pipes. The Node bridge uses the **existing** `pg` dependency and the **existing** `arl_local` PostgreSQL database and migration 063 tables. Nothing listens on an HTTP port. No database schema changes or additional assessment records are made during launch.

This is an early desktop increment, not a completed operator interface. Only a **read-only status inspection** of the existing ARL assessment engine is now wired into ENKYRON. Only read-only assessment identity and evidence **requirements** inspection are exposed. Raw evidence inspection, evidence acceptance or revalidation, live testing, knowledge editing, status transitions, CMDB and reporting are **not yet** exposed. Evidence Register is a scoped **metadata index with historical test links**, not a control assessment or proof of integrity. The human-review checklist prepares manual investigation only; it does not make or save a review decision. The historical browser Workbench is preserved but not invoked.

## Prerequisites

- Linux desktop with Python 3 and PySide6 (Qt Widgets) available.
- Node.js and the repository's installed `pg` dependency (`npm ci` if not already installed).
- Existing local PostgreSQL socket `/var/run/postgresql`, database `arl_local`, local peer-authorised OS user, and the previously applied ticket migration (063).
- The application is local single-operator software. It is **not** hardened for a remote or multi-user deployment.

## Start

From the existing repository checkout on the ENKYRON development branch:

```bash
python3 desktop/enkyron.py
```

The program opens a native desktop window, not a browser. If PySide6 is absent, install it in a Python virtual environment or through your trusted Debian package source before launching; do not run unknown installation scripts.

## Local test commands

```bash
node --check desktop/enkyron-contract.mjs
node --check desktop/enkyron-bridge.mjs
node --check desktop/enkyron-evidence-register.mjs
node --check desktop/enkyron-ticket-intake.mjs
node --test tests/enkyron-desktop.test.js tests/enkyron-evidence-register.test.js tests/enkyron-ticket-intake.test.js
python3 -B -m unittest desktop.test_enkyron_operator_state desktop.test_enkyron_evidence
```

These are code and contract tests, **not** a live PostgreSQL integration test. Real login/peer authentication, master history, ticket persistence and user experience must be verified on the intended Debian machine before acceptance.

## Desktop launcher EK icon (Debian)

The version-controlled EK logo is in `desktop/assets/enkyron.svg` (transparent background, navy/teal colourway). The icon is a visual identity asset only; it does not affect security controls or business data.

For an **existing** user-level `~/.local/share/applications/enkyron.desktop` launcher, run this from the checked-out repository:

```bash
bash scripts/install-enkyron-icon.sh
```

The script copies the icon to `${XDG_DATA_HOME:-$HOME/.local/share}/icons/enkyron.svg` and changes only the `Icon=` field of the existing `[Desktop Entry]` section. It deliberately **does not** rewrite `Exec=`, install dependencies, edit the database or create a launcher. A normal Git update does not delete the user-level installed icon. If a later installer *replaces* the `.desktop` shortcut, rerun the script. This step is not automatic and is not a deployment action.

## Security design notes

- The PostgreSQL bridge limits operations to `tickets`, `ticket`, `master`, `note`, the read-only `evidence-register`, local `create-ticket`, and audited `ticket-status`. Ticket writes are transactional, parameterised and do not touch any assessment or master record. Separate one-shot Python IPC commands `desktop.enkyron_operator_state` and `desktop.enkyron_evidence` delegate only to existing read-only ARL inspection/evidence adapters, not to arbitrary commands.
- Ticket/master reads use a PostgreSQL read-only connection; SQL is parameterised.
- Manual notes are written transactionally, with the same append-only tables and status gate as the existing Workbench.
- Document hash validation is an integrity consistency check, **not** a verified digital signature or independent authentication.
- UI text from customers is displayed as plain text, not executed or treated as instructions.
- Historical test records are read from `control_test_executions` for the same project, snapshot and control as the evidence records. Raw `input_reference`, `observed_result`, `expected_result` and `descriptor_json` are not selected or sent to Qt. Cross-snapshot/control rows are rejected. Both lists are capped at 100 entries with explicit truncation notices.
- Nothing in this UI can authorise tests, change applicability, validate evidence, close findings, create assessments or decide readiness. The ARL Engine tab explicitly reports `not_inspected`, `not_assessed` and `not_evaluated` as appropriate; **identity verification is not a security PASS**.
- Do not expose database credentials, customer data or master documents via public GitHub.
