# ARL Python Operator — combined integration review and Debian acceptance

**Prepared 22 October 2026. Status: candidate only, NOT merged, NOT deployed.**

## Scope and provenance

- Source repository: `emprex/agent-risk-layer`
- Frozen base `main`: `221120b82e03c84aef6deaad2458fec1dedd71ec`
- Integration branch: `integration/arl-python-operator-safe-20261022`
- Review PR: #495 (draft, must remain unmerged until approval)
- The Python desktop stack was inherited from the full head of draft PR #494, including dependent #491, #492 and #493.
- On a single isolated integration commit, exact source file blob SHAs from the following other drafts were overlaid: #488 existing-only dashboard (9 files), #489 evidence trust/readiness (6 files), #490 CLI diagnostics (4 files). Their file paths did not collide with the Python stack.
- A follow-up integration correction aligns `arl-operator --help` with #488's **existing-only**, no-bootstrap contract and adds a regression assertion.

**Do not merge #488–#494 blindly after integrating #495.** Their code is included in this candidate. Reconcile/close the superseded draft PRs only after review and successful owner-directed integration to `main`. Never rewrite historical PR evidence.

## Mandatory gate 1 — exact GitHub candidate CI

At the final PR #495 head, require:
- Syntax and ESLint.
- Node and Python regression suite, including headless desktop subprocess and report-bundle tamper checks.
- Controlled scenario and detection regressions.
- Disposable CI PostgreSQL integration.
- Diff examination: no file deletions, migration/schema changes, generated evidence, .env, credentials or target modifications.
- Confirm there were no accidental changes to `main` and no workflow checks borrowed from an earlier SHA.

A green build checks the integrated *candidate code* under test fixtures. It does not attest the real workstation, GUI rendering, production agent testing, or the correctness of every human-decision rule.

## Mandatory gate 2 — expert human security review

Reviewer should examine:
1. #489 effective evidence trust: expired/retained, red-team signature, source temporal relationship, remediation artifact, approval-only rows; verify **no false elevation of readiness** and no historical evidence reclassification as silently accepted.
2. #488 existing-only dashboard: unknown target, zero-eligible-controls, stale SHA and incomplete-scope cases must fail closed or show HOLD without creating a project/snapshot.
3. Python subprocess bridge: deny Node preload injection, reject untrusted/mismatched structured output, never display secrets or private report material.
4. Explicit actor/scope/authorisation boundaries; the read-only Python interface **must not** become an alternative evidence or deployment authority.
5. All report/checksum labels: content consistency is not signature, finding, vulnerability proof or external disclosure approval.

## Mandatory gate 3 — *later* physical Debian acceptance, preserving the laptop

The owner is currently away from the laptop. **Do not execute these remotely or assume they have run.**

First, from the original `~/agent-risk-layer` checkout, inspect before any update:

```bash
cd ~/agent-risk-layer || exit 1
git status --short
git rev-parse HEAD
node --version
python3 --version
```

If the working tree has local changes, **preserve them**. Do not `reset --hard`, `clean -fdx` or `pull` into it.

After explicit owner authorisation and security review, use a separate, throwaway acceptance checkout/worktree (not the existing ARL working folder) for PR #495's pinned final SHA. The exact commands must be adjusted to actual local repository/branch state. Do not point the test checkout to production services or customer credentials.

On that isolated checkout:
- Confirm the selected Git SHA matches the approved PR #495 exact head.
- Run `python3 -m unittest discover -s desktop -p 'test_*.py'`.
- Run `python3 desktop/arl_operator.py --check` with no customer database access.
- Run `node bin/arl-operator.mjs --help`, `--version` and `doctor`; verify `doctor` does not claim DB or target readiness.
- Verify `python3 -m tkinter` opens a native window; if not installed, discuss `python3-tk` with the owner rather than changing workstation dependencies without permission.
- Launch `python3 desktop/arl_operator.py`. Check font sizes, tab navigation, scrolling, focus, visibility and message text on the **actual** Debian display.
- Check the Overview, Assessments, Evidence, Controlled tests and Reports tabs, including clear labels for disabled functions.
- Choose only a **disposable, clean, authorised synthetic Git repository**. Verify that an unregistered assessment remains unavailable, without automatically creating user/project/snapshot/database rows.
- Exercise an existing registered *disposable* assessment only after PostgreSQL's **isolated test database**, authority rules and credentials are reviewed. Check exact SHA/snapshot/assessment binding and unchanged record counts before/after read-only inspection.
- Create an **isolated synthetic** report bundle with the existing ARL fixture/test tools and check that Python verifies content consistency and refuses tampering. Do not open real customer material for a UI smoke test.
- Confirm database/evidence/project counts and the target Git SHA did not change; do not run active third-party tests or deployment decisions.

If any step fails, **stop**. Retain current production/local ARL setup, record exact reproduction/expected behaviour, fix on the integration branch, rerun CI and repeat acceptance.

## Required owner sign-off before main merge

- [ ] Final exact-head GitHub CI is green.
- [ ] Security-sensitive #489 and dashboard #488 semantic reviews completed.
- [ ] Python GUI actually rendered and used on Debian.
- [ ] Separate-DB disposable assessment round-trip verified.
- [ ] No target, migrations, evidence or deployment state modified.
- [ ] Product usability accepted (not merely source correctness).
- [ ] Duplicate draft PRs reconciled, merge strategy chosen and owner approved.

**Current decision: HOLD FOR HUMAN REVIEW AND LOCAL DEBIAN ACCEPTANCE.** No release authority is delegated to the LLM, Python, CI or a checksum.
