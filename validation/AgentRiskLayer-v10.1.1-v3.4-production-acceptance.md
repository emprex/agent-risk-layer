# AgentRiskLayer v10.1.1 / arl-risk-v3.4 Production Acceptance

Date: 2026-08-09
Environment: Production
Repository commit: 8b51f7445211cafc569f4710941455bcfa202dbc
Application version: 10.1.1
Scoring model: arl-risk-v3.4

## Test

Synthetic mixed-state customer assessment executed through the production browser.

Assessment name: v3.4 final acceptance
Assessment ID: asm_f3305b1476aa457bad4cf3f82c536b4d
Agent type: Customer support agent

The synthetic test intentionally included:

- one unresolved answer: memory isolation = "I'm not sure"
- one not-applicable answer: no credentials/secrets
- one safe declared control with supporting evidence ready but not yet reviewed
- one declared High weakness: prompt wording as the primary untrusted-content defence

## Expected behaviour

- unresolved information is treated as an information gap, not a vulnerability
- not-applicable control is explicitly represented as declared N/A
- supporting-evidence-ready does not create a verified control
- High declared weakness creates a High finding
- aggregate numerical score does not downgrade the highest material finding
- missing information plus a material weakness produces HOLD FOR INFORMATION AND REMEDIATION

## Observed production result

- deployment decision: HOLD FOR INFORMATION AND REMEDIATION
- aggregate declared score: 3/100
- overall declared risk band: High
- highest declared finding: High
- security information completeness: 96%
- unresolved security questions: 1
- declared control weaknesses: 1
- credible attack-path concerns: 0
- memory isolation recorded as unresolved information
- prompt-injection boundary recorded as F-01 High
- credentials recorded as NOT-APPLICABLE-DECLARED
- permissions evidence recorded as "Supporting evidence ready - not yet linked or reviewed"
- verified low-risk controls: 0/17

## Result

PASS

The production result preserved the intended arl-risk-v3.4 evidence and scoring semantics for the tested mixed-state customer journey.

## Evidence

Generated production PDF:
v3-4-final-acceptance-agent-risk-report.pdf

PDF SHA-256:
38baf1b6972b4eeaa55d893247001ae70b9bb68239f9b33a42efe4fc0271e1bd

The PDF itself is not committed because it contains production assessment identifiers and is retained separately as test evidence.

## Limitations

This acceptance proves the tested production assessment/result/report semantics only.

It does not establish that:
- all AgentRiskLayer functionality is defect-free
- the synthetic system is secure
- any customer system has been technically verified
- source code, cloud configuration or runtime behaviour was inspected during this assessment
- an independent penetration test or certification was performed

The generated PDF also exposed separate report-presentation issues, including static wording that can imply technical inspection/adversarial testing when none was attached. Those issues are not treated as failures of the v3.4 scoring-semantics acceptance and should be remediated separately.
