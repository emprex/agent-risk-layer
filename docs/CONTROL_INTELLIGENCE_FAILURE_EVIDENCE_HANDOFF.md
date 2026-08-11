# Control Intelligence failed-test evidence handoff

## Purpose

This note defines the trust boundary between a failed guided control test, customer-submitted observed evidence, finding creation and later deployment/closure decisions.

The goal is to avoid a dead-end where a reproducible failed test has attached customer evidence but the workflow cannot create a finding merely because that evidence is not independently verified.

## Trust semantics

- A completed failed test remains a version-bound test execution and does not by itself become verified evidence.
- Customer/test-output/review evidence remains `unverified` unless an authorised trusted source binds it as verified. This change does not promote customer evidence to `verified`.
- For the **failure → finding** handoff only, active `unverified` or `verified` evidence may satisfy the evidence stage when it is bound to the exact failed test execution, current project, current snapshot and control.
- `declared`, `invalid`, `stale` or evidence bound to another test/control/snapshot cannot satisfy the failure handoff.
- Finding creation rechecks the exact failed-test/evidence binding and evidence integrity server-side before creating the finding.
- Passed controls still require active `verified` evidence before they can be treated as controlled with evidence.
- Deployment `proceed` still requires current passed tests and current `verified` evidence for applicable controls; unverified failure evidence never counts as deployment proof.
- Finding closure still requires a passed exact retest on a changed remediated snapshot, verified retest evidence and active remediation implementation evidence.

## Inconclusive tests

An `inconclusive` execution remains in the test stage. It must be resolved with additional evidence or rerun; it cannot advance to finding, controlled-with-evidence or deployment completion merely because another evidence record exists.

## Backward compatibility and data preservation

No migration or destructive data change is required. Existing failed tests and existing active unverified evidence remain immutable history and become eligible for the failure-to-finding handoff only when their existing bindings match the current failed execution. No evidence verification state is rewritten.

## Security limitation

Allowing unverified evidence to support **finding creation** is deliberately narrower than accepting it as proof of control effectiveness. A finding is an assertion that an observed failure needs remediation; it is not a claim that the system is controlled. Verification requirements therefore remain stricter for positive assurance, deployment decisions and closure.
