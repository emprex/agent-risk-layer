# ARL Python Operator — first explicit transactional LAB-only action (23 October 2026)

**Candidate state: DRAFT. Not merged into product main and not approved for customer use.**

## Why the initial Operator is not yet complete

The existing Python/Tkinter UI is a read-only viewer of local Git metadata, previously prepared assessment/snapshot records, evidence workplan counts and immutable report-bundle consistency. It cannot manage a full customer engagement, apply accountable human decisions, execute separately authorised controlled tests, collect/review evidence, perform exact retests or produce final signed-off customer reports.

This PR enables just the FIRST bounded write: **preparing a new synthetic lab assessment record** via existing canonical ARL authority. It does not claim the full lifecycle is implemented.

## Action in Assessments tab

- Select a **clean committed synthetic local Git target you own**; the GUI keeps its exact Git SHA.
- Configure an entirely separate, owner-created **local PostgreSQL database named `arl_operator_lab`** through the environment variable `ARL_OPERATOR_LAB_DATABASE_URL`. This PR never creates the PostgreSQL database itself.
- Click **Prepare synthetic LAB assessment (writes lab DB)**.
- Read the warning identifying the database write. Explicitly approve.
- Type `PREPARE LAB <full-40-character-selected-Git-SHA>` exactly.
- The Python bridge strips ordinary production `DATABASE_URL`, `NODE_OPTIONS`, `NODE_ENV`, target adapter and other inherited environment values. It passes only the dedicated lab URL, exact SHA and confirmation to a **specialised** Node.js command.
- The Node.js command independently requires that consent, a pinned clean target, the `arl_operator_lab` database on localhost, and absence of an existing assessment for that target.
- The command calls canonical `inspectFrozenRepository`, `resolveLocalAssessmentContext` and `ensureInitialAssessmentSnapshot`. It may initialise/migrate **only that lab database**. It deliberately never runs `runLocalAssessment`, `runArlAgent`, an active test, human applicability/evidence approval, finding or final readiness decision.
- On success the GUI displays only newly allocated project/assessment IDs, the frozen SHA and explicit **UNKNOWN/HOLD, no tests** labels. The operator may then inspect the new assessment via the existing read-only button.

## Operator safety / failure semantics

This is a **real database write**, not a read-only diagnostic. It can leave new records in the isolated lab even if a later step fails; the GUI does not automatically retry or roll back partial writes, and it never states that nothing was written after a late failure. Inspect the isolated lab state before retrying.

The Node command will NOT use the ordinary ARL `.env` or customer PostgreSQL `DATABASE_URL`. The dedicated URL is not printed. Node test-mode SQLite is allowed only for automated synthetic fixtures; normal product uses local PostgreSQL.

A synthetic lab target is never permission to assess external parties, scan production agents, execute tools/API actions or assert control validation.

## Test evidence in this PR

- Node.js synthetic isolated SQLite regression checks: successful first creation; one new project/assessment/snapshot; repeat refused; missing confirmation, wrong SHA, dirty target, malformed CLI or unsafe/nonlocal PostgreSQL URL all refused. Test verifies no target Git modifications.
- Python unit tests: explicit confirmation, secret-safe environment, forbidding injected Node flags, fail-closed result schema, refusal to display forged READY/PASS/security outputs or private stderr.
- Existing CI retains native Tkinter GUI smoke in a virtual display and full detection/scenario/PostgreSQL checks. The GUI smoke only establishes that tabs/rendering open; it does not validate a real user-approved lab write.

## Remaining required stages before a commercial full Operator

1. Independent code/security review of PR #489's effective evidence trust/readiness logic and current GUI integration.
2. Human acceptance of the Python GUI on Debian using a **disposable synthetic Git target and a separate lab PostgreSQL database**, preserving the original ARL checkout and all evidence.
3. Snapshot-bound graphical review of evidence requirements and human applicability decisions using authenticated, auditable canonical APIs.
4. Controlled test planning, Rules of Engagement and explicit human approval, with audited authorised runner invocation.
5. Evidence submission/validation, findings/severity, remediation, exact target-change retest, customer report review and human release/closure workflow.
6. Packaging, recovery, support, local secrets handling, permissions, automated GUI interaction tests and complete A–Z acceptance.

**Release HOLD.** Never merge this stacked draft directly to main: it depends on PR #497 → #496 → combined #495. Review and reconcile the full stack first. No deletion, current customer database update or deployment is part of this PR.
