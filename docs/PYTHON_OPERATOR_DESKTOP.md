# Python desktop Operator — read-only foundation (22 October 2026)

## What it is

A new **desktop presentation layer** for the existing AgentRiskLayer product. The canonical Node.js security assessment engine, PostgreSQL records, evidence lineage and human authority stay unchanged. This proposal does **not** replace `npm run assess:local`, `npm run operator:open`, or any existing security decision API.

This version provides a simple Python/Tkinter window with Overview, Target, Evidence, Controlled tests and Reports tabs. Only **local diagnostics** and **explicit local Git repository selection/metadata inspection** are currently functional. All evidence, test and report tabs explicitly say they are not connected. They contain no execution or approval buttons.

## Debian desktop use — only after review/merge/local sync

From the canonical `~/agent-risk-layer` checkout:

```bash
# The existing Python installation must support Tkinter.
python3 -m tkinter

# Start desktop interface (no PostgreSQL or target access on launch):
python3 desktop/arl_operator.py

# Run headless read-only diagnostics (no GUI needed):
python3 desktop/arl_operator.py --check

# Only if explicitly choosing a local target to inspect its Git metadata:
python3 desktop/arl_operator.py --check --target "$HOME/arl-target-mcp-agent"
```

If `python3 -m tkinter` reports a missing Tkinter module, Debian typically provides it via `python3-tk`. Installing an OS package is a **separate owner decision**, not part of this PR. Do not install packages or modify the laptop remotely for this test.

## Safety/architecture

- Standard-library-only Python and Tkinter; no pip dependencies, no Node.js engine rewrite, no new server, port, hosted instance, authentication system or database adapter.
- Reads only `package.json` and local Git metadata; no `.env` contents, tokens, customer files or stored assessment evidence are opened.
- Git metadata invocations use a fixed argv list (never a shell), disable optional Git locks/fsmonitor and terminal authentication. No fetch, checkout, reset, pull, git index write, migration, or outbound HTTP.
- Selecting a local repository does not establish scope, ownership, authorisation, a frozen ARL snapshot or permission for active tests.
- No assessed control can be displayed as PASS here; no findings, evidence validation, authorisations, closure or readiness are written.
- No assumptions about the state of the Debian machine or its PostgreSQL connection.
- The GUI is **not yet a transaction-capable Operator**; do not market it as a completed assessment platform.

## Separation from existing draft PRs

- PR #488: existing-only opening and first-assessment fix for the canonical offline Operator.
- PR #489: effective-evidence readiness semantic correction.
- PR #490: read-only Node CLI diagnostics and cleanup baseline.

This Python GUI proposal is additive and does not modify their files. Resolve their reviews and merge ordering before adding any transaction-capable GUI functions.

## Acceptance evidence

- Headless Python `unittest` suite (`desktop/test_operator.py`) validates read-only metadata access, no automatic GUI launch and fail-closed handling of missing targets.
- A small Node `node:test` bridge (`tests/python-desktop-operator.test.js`) adds the Python tests and headless `--check` invocation to the existing `npm test` CI path.
- CI cannot prove pixel layout, native Tkinter display, accessibility, Debian packaging or operator usability. These require a later physical Debian desktop acceptance test.
- This PR is deliberately draft and must not be merged until exact-head CI, diff review and an authorised human decision.

## Next GUI block (not implemented)

Read-only, validated display of **existing** snapshot-bound assessment metadata and verified offline dashboard artifacts, using the existing canonical assessment APIs with fail-closed scope binding. Do not generate/alter assessments just to populate the GUI.

A later transaction-capable GUI must delegate to existing ARL authority boundaries, authenticate its human operator, explicitly display proposed actions, enforce per-action confirmation, and record audit/provenance. Never treat the Python client as an independent security decision engine.

## Consolidated desktop integration validation

This integration contains the stacked Python Operator GUI work (assessment inspection, bounded evidence workplans and pack pagination, explicitly confirmed synthetic LAB preparation, and existing report-bundle verification). The graphical interface does **not** yet execute active security tests, record human evidence acceptance, or generate a completed customer assessment report. The merge must preserve the exact-head CI `test` check and require an authorised synthetic end-to-end desktop acceptance before customer deployment.
