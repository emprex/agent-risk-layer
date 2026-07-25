# Inspector rule-authoring standard

Every new rule must have:

1. A stable `ARL-<DOMAIN>-NNN` identifier.
2. A precise observable condition.
3. Severity justified by credible impact.
4. Explicit confidence.
5. Remediation that can be tested.
6. Relevant OWASP, NIST, SLSA or other primary-framework mapping.
7. At least one positive and one negative fixture.
8. Proof that source or matched secret values are absent from the bundle.
9. A false-positive analysis.
10. A changelog entry and policy-version decision.

Rules must not claim that absence of a static signal proves absence of a control. Wording such as “not evident in scanned configuration” is required for low-confidence absence checks.

Critical rules should be limited to observations with a plausible direct path to credential compromise, arbitrary code execution, broad privileged access, data exfiltration or unsafe high-impact action.
