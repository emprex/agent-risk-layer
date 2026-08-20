# Assessment scope cache hotfix — 20 August 2026

The Atlas Lite paid-customer exercise exposed a browser asset-version mismatch after the scope-integrity fix merged.

The production Findings page could load a fresh bootstrap document while still importing an older `control-plane.js` URL (`v=20260814.6`). That allowed stale client logic to coexist with newer assessment/remediation helpers and produce contradictory UI such as an Atlas Lite assessment banner with a Northstar runtime scope.

This hotfix changes only asset version identifiers so browsers request the current remediation code after deployment. It does not rewrite assessment, remediation or evidence history.

Verification after deployment:

1. Hard refresh the paid Atlas Lite Findings URL.
2. Confirm no Northstar runtime scope is selected for the Atlas Lite assessment.
3. If no exact assessment case contains remediation records, show the dedicated remediation-scope handoff rather than historical runtime remediation.
4. Do not accept closure until the exact assessment-bound case is active.
