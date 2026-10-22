# Python Operator — existing-assessment selection (read only)

This is an incremental, **stacked draft** following the Python GUI foundation and saved-report verification. It does not merge or deploy anything.

## Real workflow supported

1. Open the Python Operator and choose **Assessments**.
2. Select a local Git repository for which you are authorised.
3. The GUI shows its local commit SHA and refuses an unclean target.
4. Click **Inspect existing assessment (read only)**.
5. The existing ARL Node.js inspection command looks up the previously created local assessment using the existing canonical repository binding, local PostgreSQL, and the frozen Git SHA. It **does not bootstrap** a missing project, assessment, database or snapshot.
6. Only when ARL confirms an exact SHA/snapshot match does Python show the project ID, assessment ID, snapshot ID, SHA and recorded environment.

No Python-side SQL, new database schema, new persistent authority, raw evidence, architecture notes or customer secrets.

## Canonical additions

- `src/agent/arl-inspect-existing-assessment.mjs --json <path>`: optional bounded JSON output while retaining its prior human-readable command. This reuses `findExistingLocalAssessmentContext`, `freezeLocalRepository` and `showLocalAssessmentContext`.
- `src/agent/existing-assessment-summary.mjs`: strict output allowlist; refuses absent, stale or conflicting snapshot bindings. It **never** treats an existing snapshot as a passing assessment.
- `desktop/assessment_bridge.py`: invokes the authoritative Node path with a pinned SHA and a restricted child environment; only projects metadata into the GUI.
- `desktop/arl_operator.py`: deliberate inspect button on the Assessments tab and headless `--inspect-existing`.
- Unit and synthetic SQLite tests prove missing assessments are not created, dirty or changed targets are rejected, and authority/secret fields cannot pass into the GUI.

### Headless local command (after review and synchronisation)

```bash
cd ~/agent-risk-layer
python3 desktop/arl_operator.py --inspect-existing "$HOME/arl-target-mcp-agent"
```

The target is **an example only**; use a clean previously authorised and locally registered repository. The CLI prints a bounded JSON summary. On failure it returns nonzero and does not reveal database errors or credentials.

## Critical limitations

- The first release is a **select-by-local-repository** workflow, not an enumeration of all clients or an unrestricted project browser.
- An assessment that exists but has no snapshot cannot be presented as valid. Missing assessments are reported as unavailable and **never initialised** from the GUI.
- An unchanged Git SHA alone does not prove scope, evidence, test validity or system security. Evidence, control outcomes, findings, readiness and deployment decisions remain `NOT INSPECTED` / `NOT EVALUATED`.
- The Node reader connects to the **owner's existing PostgreSQL**, using the established `.env` or `DATABASE_URL`. Python does not parse `.env` and does not directly speak to PostgreSQL.
- CI uses disposable synthetic SQLite for missing-record and mismatch tests; it does not test the owner's real database, live third-party agents or physical Tkinter window.
- Subsequent UI work will need an authenticated, snapshot-bound read-only evidence requirements query and a separate, explicitly reviewed design for human actions. The GUI must not bypass ARL's human authority model.
- Any deployment HOLD remains HOLD.

## Merge order

Base branch is `feat/python-operator-verified-reports-20261022` (draft PR #492), which itself depends on GUI foundation draft PR #491. Review and land those in order with exact-head CI and local Debian acceptance, then rebase this PR against the reviewed `main`. Do not merge the stacked PR into the product unreviewed.

No files deleted; no migrations, active tests, historical target changes, database mutations, or production deployment.
