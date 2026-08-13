# Control Intelligence historical failure handoff

## Purpose

A reproduced failure remains bound to the immutable system snapshot where it occurred. Moving the project to a newer snapshot must not erase that failure, move its evidence onto the newer version, or force the user to recreate the failed test.

## Evidence-chain invariant

When an unresolved failed initial test belongs to a superseded snapshot, Control Intelligence may accept owner-recorded observed evidence for that exact historical execution and may create a finding bound to the same historical snapshot. The evidence remains explicitly `unverified` unless a qualifying system-generated source proves more.

The handoff is fail-closed:

- the user must have a project recording role;
- the failed execution must belong to the same workspace, project and control;
- the submitted snapshot must exactly equal the failed execution snapshot and must be superseded;
- historical pre-finding evidence cannot smuggle runtime, approval, remediation or Red Team bindings into the old snapshot;
- finding creation still requires active observed evidence for that exact failed execution;
- immutable test/evidence digests and provenance are checked before the historical finding is created.

## Remediation chronology

A newer snapshot is not automatically evidence of remediation merely because its ID differs from the vulnerable snapshot. For an exact retest to qualify, the target snapshot must have been created after the active remediation implementation evidence. This prevents a pre-existing snapshot from being relabelled as the remediated version after a historical finding is discovered.

The expected chain is therefore:

historical failed snapshot → historical observed evidence → finding → remediation plan → implementation evidence → new immutable post-fix snapshot → exact retest → qualifying retest evidence → human closure → project deployment decision.

## Trust boundary

This workflow preserves provenance; it does not upgrade owner-entered observations into independent verification. Unknown or historical information is not a vulnerability by itself. A finding still requires the reproduced failed test and its recorded evidence, and closure still requires qualifying exact-retest evidence under the existing Control Intelligence trust rules.
