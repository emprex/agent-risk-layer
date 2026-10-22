# Python Operator — verified local report viewing

**Status:** staged read-only integration built on the Python desktop foundation in draft PR #491. This document does not claim a customer assessment, vulnerability finding, remote agent access, accredited inspection, or deployment approval.

## What changes

The Python desktop **Reports** tab now lets the operator choose a previously exported private ARL `arl-assessment-...manifest.json` report bundle. It calls the **existing** `scripts/verify-customer-report-bundle.mjs` with an argument array (no shell) to verify the immutable manifest, Markdown and JSON files together.

No duplicate Python evidence validator is created. Python checks the narrowly shaped, non-authoritative result from the canonical Node verifier and displays only:

- whether **content consistency** was established;
- assessed target Git revision and bundle content digest;
- the report's recorded readiness label, explicitly not independently verified;
- human-review and limitation text.

Python never displays report prose, raw evidence, findings, secrets, or customer JSON. The file chooser does not load an assessment, query PostgreSQL, run a security test, prepare an export, approve sharing, or change ARL state. The source verifier reads only the named private report and its two sibling files. It requires owner-only file/directory permissions, fixed schemas, trusted digest relationships and expected human-authority fields. Failed verification is **NOT ESTABLISHED**, never PASS.

## After review/merge and on the owner's Debian machine

```bash
cd ~/agent-risk-layer
python3 desktop/arl_operator.py
```

Choose **Reports → Verify saved ARL report…**, and select the existing `data/local-reports/arl-assessment-...manifest.json` in your private report directory. A saved report must already have been created by the canonical ARL workflow. The GUI will not create one.

A headless read-only check is also available for diagnosis, without Tkinter:

```bash
python3 desktop/arl_operator.py --verify-report "$HOME/agent-risk-layer/data/local-reports/arl-assessment-EXAMPLE.manifest.json"
```

Replace the example with the **exact** existing filename. The check prints a small JSON summary, returns exit status 0 when consistency is established and nonzero if refused. It does not print untrusted report contents.

## Clear trust limits

- SHA-256 correspondence is not independent provenance, a signature, evidence validity, release authorisation, or permission to disclose customer material.
- Reports are a point-in-time snapshot. The GUI does not confirm whether the selected report is current relative to PostgreSQL or the assessed target.
- `HOLD` and other labels come from the verified bundle; only the existing ARL human-decision process has authority.
- External agent assessment still requires its own explicit scope and Rules of Engagement. The Python GUI does not test HackerOne Hai.
- A customer-facing release requires the existing disclosure checks and authorised human confidentiality review.

## Safeguards and tests

- Python calls the exact existing verifier module using `node` and fixed argv, from the product checkout.
- Environment allowlist strips database variables and Node preload arguments; no `.env` is read.
- Only a canonical filename is accepted. The Node verifier rejects unsafe paths, symlinks, non-private files, malformed or inconsistent bundles and tampering.
- A bounded JSON result with an exact schema and explicit `not_assessed` decision boundary is mandatory before displaying success.
- Python unittest mocks cover failed Node execution, malformed output and forged authority fields.
- A Node integration test creates a fully synthetic private ARL bundle via the existing builder, runs Python headlessly, tampers with Markdown, and requires the bridge to reject it.
- Existing CI exercises these tests. Passing CI does **not** prove Debian desktop usability or any customer security outcome.

## Merge ordering

This is a **stacked draft** based on `feat/python-operator-readonly-desktop-20261022` (PR #491). Merge PR #491 only after review and Debian acceptance, then rebase/review this follow-up against current `main`. Do not bypass outstanding PR #488 / #489 / #490 review or change target/db/evidence authority to make the UI appear complete.

The next small UI step, after acceptance, is a snapshot-bound read-only listing of **existing** assessments, using the existing ARL authoritative query path. No second backend, no duplicate PostgreSQL authority, no unreviewed auto-PASS.
