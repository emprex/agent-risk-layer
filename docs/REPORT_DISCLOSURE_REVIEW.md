# Customer report disclosure review

An offline SHA-256 consistency check **does not** approve external disclosure. An accountable reviewer must inspect the private Markdown and JSON, including scope, findings, decisions and free text, before sharing. Preserve HOLD unless an authorised human records a decision.

## Optional read-only disclosure preflight

Run on the owner-controlled machine after a report was exported:

```bash
npm run report:disclosure -- "/absolute/private/report-directory/arl-assessment-...manifest.json"
```

This calls the **existing immutable bundle verifier first**, then scans the verified report JSON **and the verified customer-facing Markdown**. It produces **JSON field paths or Markdown line numbers, fixed indicator labels, bounded counts, and a reviewer checklist**. It never repeats flagged text, writes new files, contacts an external service, accesses PostgreSQL, or executes a target test. A phrase appearing in both files may count twice because each file is inspected separately.

The indicators flag some obvious private-key markers, bearer-token strings, credential assignments, email addresses and URLs containing query strings. They are **heuristics**, not proof of a leak, complete secret scanning, or a data classification decision. Large JSON fields, Markdown lines longer than 16,384 characters, more than 20,000 Markdown lines, or excessively deep/large JSON structures produce `inspectionIncomplete: true`. This should trigger additional manual inspection. Markdown line numbers are locators, not content excerpts.

The result is **always `HUMAN_DISCLOSURE_REVIEW_REQUIRED`**, even with zero detected indicators. Verify the intended recipient, disclosure agreement, scope and client/third-party confidentiality, review all text manually, protect the manifest SHA-256 digest independently, and record accountable human permission through the agreed operational process. Neither `report:verify` nor `report:disclosure` creates a finding, closes one, approves a report, signs evidence or lifts deployment HOLD.

Avoid copying confidential fields, credentials, or customer evidence into GitHub issues or ChatGPT while investigating a flagged location.
