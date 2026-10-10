# Customer report disclosure review

An offline SHA-256 consistency check **does not** approve external disclosure. An accountable reviewer must inspect the private Markdown and JSON, including scope, findings, decisions and free text, before sharing. Preserve HOLD unless an authorised human records a decision.

## Optional read-only disclosure preflight

Run on the owner-controlled machine after a report was exported:

```bash
npm run report:disclosure -- "/absolute/private/report-directory/arl-assessment-...manifest.json"
```

This calls the **existing immutable bundle verifier first**, then looks only at the verified report JSON already read from the private bundle. It produces **field locations, fixed indicator labels, bounded counts, and a reviewer checklist**. It does not repeat the flagged text, write new files, contact an external service, access PostgreSQL, or execute a target test.

The indicators flag some obvious private-key markers, bearer-token strings, credential assignments, email addresses and URLs containing query strings. They are **heuristics**, not proof of a leak, complete secret scanning, or a data classification decision. Large fields or excessively deep/long documents produce `inspectionIncomplete: true`. This should trigger additional manual inspection.

The result is **always `HUMAN_DISCLOSURE_REVIEW_REQUIRED`**, even with zero detected indicators. Verify the intended recipient, disclosure agreement, scope and client/third-party confidentiality, review all text manually, protect the manifest SHA-256 digest independently, and record accountable human permission through the agreed operational process. Neither `report:verify` nor `report:disclosure` creates a finding, closes one, approves a report, signs evidence or lifts deployment HOLD.

Avoid copying confidential fields, credentials, or customer evidence into GitHub issues or ChatGPT while investigating a flagged location.
