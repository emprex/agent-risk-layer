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

## First implemented operator workflow

- View and search the first 100 existing PostgreSQL tickets (search narrows results).
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
node --test tests/enkyron-desktop.test.js tests/enkyron-evidence-register.test.js
python3 -B -m unittest desktop.test_enkyron_operator_state desktop.test_enkyron_evidence
```

These are code and contract tests, **not** a live PostgreSQL integration test. Real login/peer authentication, master history, ticket persistence and user experience must be verified on the intended Debian machine before acceptance.

## Security design notes

- The PostgreSQL bridge limits operations to `tickets`, `ticket`, `master`, `note` and the read-only `evidence-register`. Separate one-shot Python IPC commands `desktop.enkyron_operator_state` and `desktop.enkyron_evidence` delegate only to existing read-only ARL inspection/evidence adapters, not to arbitrary commands.
- Ticket/master reads use a PostgreSQL read-only connection; SQL is parameterised.
- Manual notes are written transactionally, with the same append-only tables and status gate as the existing Workbench.
- Document hash validation is an integrity consistency check, **not** a verified digital signature or independent authentication.
- UI text from customers is displayed as plain text, not executed or treated as instructions.
- Historical test records are read from `control_test_executions` for the same project, snapshot and control as the evidence records. Raw `input_reference`, `observed_result`, `expected_result` and `descriptor_json` are not selected or sent to Qt. Cross-snapshot/control rows are rejected. Both lists are capped at 100 entries with explicit truncation notices.
- Nothing in this UI can authorise tests, change applicability, validate evidence, close findings, create assessments or decide readiness. The ARL Engine tab explicitly reports `not_inspected`, `not_assessed` and `not_evaluated` as appropriate; **identity verification is not a security PASS**.
- Do not expose database credentials, customer data or master documents via public GitHub.
