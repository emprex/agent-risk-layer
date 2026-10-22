# Python Operator — snapshot-bound evidence work plan

**Status:** proposed read-only GUI workstream (stacked on draft PR #493). This is not an end-to-end agent assessment, a finding, an evidence-acceptance decision or a deployment authorisation.

## Operator experience

1. In **Assessments**, select an explicitly authorised, clean local Git target.
2. Click **Inspect existing assessment (read only)**. ARL must already have an exact repository/assessment/snapshot binding.
3. Go to **Evidence** and click **Read existing evidence work plan (read only)**.
4. The GUI shows the exact snapshot ID, 108-control workflow coverage, number of criterion instances, missing static observations, static candidates, human documentation requirements, runtime checks requiring separate authorisation, and source lineage issues.
5. An indexed table groups numbered evidence collection packs by category, requirement instances and affected controls.

No raw customer evidence, collector/criterion free-text, API credentials, source file contents, test payloads or exception records are transferred to Python.

## Real source of truth

This feature adds `--evidence-json` to the existing `src/agent/arl-inspect-existing-assessment.mjs` read-only command. The command uses ARL's existing `findExistingLocalAssessmentContext`, `freezeLocalRepository`, `showLocalAssessmentContext` and the exact existing `runLocalAssessment(..., 'Show assessment evidence requests', ...)` action.

The canonical engine checks the local frozen Git SHA and existing assessment binding, builds the evidence request inventory, checks the scope/snapshot again and refuses a changed target. A strict allowlist projection `src/agent/existing-evidence-workplan.mjs` returns only numeric metadata and numbered workstream groupings. The Python `desktop/evidence_bridge.py` checks the exact project, assessment, snapshot, SHA and non-authoritative fields before display.

This is deliberately **not** a second evidence engine, SQL layer, runtime test executor or approval system.

## Optional headless read

After human code review, controlled merge and Debian checkout update:

```bash
cd ~/agent-risk-layer
python3 desktop/arl_operator.py --inspect-evidence "$HOME/your-clean-authorised-target"
```

The command refuses an unregistered, dirty, changed or missing-snapshot target. No new assessment or snapshot is automatically created.

## Limits

- Static candidates are not validated evidence.
- Requirements counts and packs are **work planning**, not finding counts or pass/fail totals.
- Controls in other workflow lanes remain in scope; they are not cleared or excluded from the full assessment.
- Runtime requirements do **not** grant permission to execute tests. Written Rules of Engagement and responsible human authorisation are separate.
- The GUI reports the snapshot-bound state **at the time of reading** and does not preserve a transactional lock after the screen is displayed.
- CI uses synthetic isolated databases and mocks, not customer PostgreSQL, HackerOne Hai or live production traffic.
- The Tkinter desktop rendering and actual owner workstation remain untested until local acceptance.
- This feature does not yet show criterion-level detail or allow evidence upload/approval. Those are separate future stages with explicit identity and security reviews.

## Safe merge order

The branch is stacked on `feat/python-operator-existing-assessment-20261022` (draft PR #493), which is stacked on #492 and #491. Do not merge from this head before reconciling its base and human review. Existing Operator fixes #488/#489 and CLI #490 are separate open work that must not be overwritten.

No data deletion, migration, target changes, production deployment, active test or modification of canonical `main` is part of this PR.
