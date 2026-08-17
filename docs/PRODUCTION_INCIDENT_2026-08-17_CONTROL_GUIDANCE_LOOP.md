# Production incident: focused Control Intelligence page loop — 17 August 2026

## Observed
A normal-user hard refresh of the Northstar focused Control Intelligence Test page became unresponsive immediately after deployment of `2da4e94790c649bae29996050a1094ffee7058be`.

## Root cause
The newly loaded customer-guidance module attaches a subtree `MutationObserver`. In the Test stage it unconditionally rewrites option/button text on every observer callback. Those text writes create new child-list mutations and can continuously retrigger the observer.

## Immediate containment
Stop loading `control-intelligence-customer-guidance.js` on the focused control page. Keep the existing core `control-intelligence-control.js`, workflow UX, evidence validation, safe defaults, Red Team binding and capability remediation modules unchanged.

## Evidence boundary
This containment changes presentation only. It does not change snapshots, applicability, tests, evidence, findings, runtime records, approvals, assessment scoring or deployment decisions. Northstar historical and current evidence remain untouched.

## Follow-up
Reintroduce the customer guidance only after it is made idempotent/non-reentrant and browser-tested against repeated DOM mutations.