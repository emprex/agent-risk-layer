# Control Intelligence journey trust alignment

## Purpose

The browser and server must preserve the same evidence-chain state for an unresolved finding. A later snapshot or evidence-lifecycle transition must not rewind an existing finding to the pre-finding evidence-entry step.

## Security invariant

A Control Intelligence finding is created only after the server accepts active observed evidence for a reproduced failed test. Once that finding exists, the completed failure-evidence transition is historical provenance. It remains part of the finding chain even if the original evidence later belongs to an older snapshot or its current verification state changes.

This does not relax the creation gate: a failed test without a finding still requires observed evidence before a finding can be created.

For closure, the separate exact-retest gate remains unchanged. A passed retest still requires qualifying verified evidence such as an integrity-verified customer-operated Red Team binding before the finding can be closed.

## Regression covered

The RefundMate controlled training walkthrough exposed a client/server mismatch after a signed Red Team baseline/retest pair was bound. The server correctly kept the unresolved control at the retest/closure stage, while the browser independently re-derived the chain and rewound to Step 3 because the original failure evidence was no longer in the current active evidence set.

The browser derivation now preserves the completed evidence stage when an open finding already exists, matching the server's guarded workflow semantics while keeping the no-finding evidence gate fail-closed.
