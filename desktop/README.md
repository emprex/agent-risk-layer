# ENKYRON — Native desktop prototype (Debian)

ENKYRON is the **Qt 6 / PySide6 desktop frontend** for AgentRiskLayer. It is not a website, an Electron app, or an HTML wrapper.

## First implemented operator workflow

- View and search the first 100 existing PostgreSQL tickets (search narrows results).
- Open an existing ticket and inspect scope, target, assessment binding, notes and activity.
- Read the latest linked master dossier **only after SHA-256 integrity and project / assessment / snapshot / target binding checks**.
- Append manual work notes to the existing ticket, recording an append-only ticket event.
- Closed tickets cannot receive new notes. No security decision or test is ever triggered.
- Open the native **ARL Engine** tab and request a read-only inspection using the **existing** Python Operator `assessment_bridge.inspect_existing`, which delegates to the canonical Node ARL command. ENKYRON first validates the master and requires the latest snapshot to be current; the existing reader must confirm the identical project, assessment, snapshot and frozen target SHA. No assessment is created if missing.

The Python Qt process talks to `desktop/enkyron-bridge.mjs` through one-shot JSON messages over local process pipes. The Node bridge uses the **existing** `pg` dependency and the **existing** `arl_local` PostgreSQL database and migration 063 tables. Nothing listens on an HTTP port. No database schema changes or additional assessment records are made during launch.

This is an early desktop increment, not a completed operator interface. Only a **read-only status inspection** of the existing ARL assessment engine is now wired into ENKYRON. Evidence inspection, live testing, knowledge editing, status transitions, CMDB and reporting are **not yet** exposed. The historical browser Workbench is preserved but not invoked.

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
node --test tests/enkyron-desktop.test.js
python3 -B -m unittest desktop.test_enkyron_operator_state
```

These are code and contract tests, **not** a live PostgreSQL integration test. Real login/peer authentication, master history, ticket persistence and user experience must be verified on the intended Debian machine before acceptance.

## Security design notes

- The PostgreSQL bridge limits operations to `tickets`, `ticket`, `master`, and `note`. A separate one-shot Python IPC command `desktop.enkyron_operator_state` delegates only to ARL's existing read-only assessment inspector, not to an arbitrary command console.
- Ticket/master reads use a PostgreSQL read-only connection; SQL is parameterised.
- Manual notes are written transactionally, with the same append-only tables and status gate as the existing Workbench.
- Document hash validation is an integrity consistency check, **not** a verified digital signature or independent authentication.
- UI text from customers is displayed as plain text, not executed or treated as instructions.
- Nothing in this UI can authorise tests, change applicability, validate evidence, close findings, create assessments or decide readiness. The ARL Engine tab explicitly reports `not_inspected`, `not_assessed` and `not_evaluated` as appropriate; **identity verification is not a security PASS**.
- Do not expose database credentials, customer data or master documents via public GitHub.
