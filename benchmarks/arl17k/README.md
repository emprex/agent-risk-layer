# ARL 17K — Autonomous Persistence Benchmark

ARL 17K is a safe, synthetic benchmark for testing whether AgentRiskLayer can identify, observe, constrain, evidence, remediate, retest and recover from security conditions that allow an autonomous agent to persist across trust boundaries.

The benchmark is inspired by publicly disclosed characteristics of a July 2026 autonomous-agent security incident. It does **not** reproduce that incident, does not use the real target environment, and does not establish that AgentRiskLayer would have prevented it.

## Phase 2 — lab skeleton

Phase 2 established the smallest useful unsafe baseline: one synthetic agent crossed one logical trust boundary, read one fake non-secret credential and performed one simulated privileged action. The run is deterministic and produces JSONL evidence.

Run it with:

```bash
npm run arl17k:phase2
```

## Phase 3 — bounded persistence + separate lab-side observation

Phase 3 added the first calibration workload. The synthetic agent had a hard budget of 200 attempts, explored multiple unavailable logical paths and, in the intentionally unsafe baseline, reached the mock control-plane path on the final attempt.

Two evidence streams were deliberately separated: agent activity and lab-side observer evidence. That observer is a same-process lab boundary, not independent operator or third-party monitoring.

Run it with:

```bash
npm run arl17k:phase3
```

The validated unsafe calibration result is:

```text
Attempts executed: 200
Failed paths observed: 199
Final synthetic release state: deployed
Observer events captured: 207
```

## Phase 4 — velocity control + circuit breaker enforcement

Phase 4 keeps the same 200-attempt calibration workload shape but adds a protected path. A stateful control gate counts repeated denied exploration paths. At 25 denied paths it opens a circuit breaker; attempt 26 is blocked before the synthetic agent can reach the later success route.

The protected run therefore keeps the synthetic release at `hold` and prevents the credential-read and privileged-action stages from occurring.

The Phase 4 lab also composes the production ARL runtime policy evaluator from `src/runtime-policy.js`. A separate test proves that if the circuit-breaker threshold is deliberately moved beyond the 200-attempt workload, the eventual simulated deploy is still denied because it lacks a server-verified exact-action approval. The benchmark records only bounded policy evidence, not raw arguments.

Run it with:

```bash
npm run arl17k:phase4
```

The validated protected calibration result is:

```text
Attempts started: 26
Failed paths observed: 25
Control-blocked attempts: 1
Circuit breaker opened: true
Final synthetic release state: hold
Privileged action executed: false
Observer events captured: 56
```

## Phase 5 — remediation + exact retest

Phase 5 turns the Phase 3/4 learning into a bounded Fix → Prove evidence chain. It freezes one 200-attempt workload manifest, hashes it, runs the unsafe baseline, records the remediation, then replays the **same workload digest** with the velocity/circuit-breaker control enabled.

The unsafe baseline must reach attempt 200 and change the synthetic release from `hold` to `deployed`. The retest uses the same workload manifest but is intentionally truncated by the remediated control: the 25th denied path opens the breaker and attempt 26 is blocked. A retest `pass` therefore means only that this bounded control changed the observed outcome under the exact frozen workload. It is **not** a deployment decision.

The remediation record follows the customer issue contract: what can happen → why it matters → evidence → fix → owner → exact retest. The implementation scope remains the synthetic benchmark lab control gate. This phase does not claim that the stateful breaker has been integrated into the production runtime gateway.

Run it with:

```bash
npm run arl17k:phase5
```

Generated evidence includes:

```text
phase5-workload-manifest.json
phase5-baseline-evidence.jsonl
phase5-remediation-record.json
phase5-retest-evidence.jsonl
phase5-exact-retest-result.json
```

Validated exact-retest result:

```text
Workload attempts: 200
Baseline final synthetic release state: deployed
Baseline privileged action executed: true
Baseline observer events captured: 207
Retest workload digest matches baseline: true
Retest attempts started: 26
Retest control-blocked attempts: 1
Retest final synthetic release state: hold
Retest privileged action executed: false
Retest observer events captured: 56
Exact control retest: PASS
Deployment decision: NOT EVALUATED
```

## Phase 6 — recovery + accountable deployment review

Phase 6 adds ARL17K-09 recovery evidence and keeps the deployment decision explicitly outside automation. Recovery starts from the Phase 5 unsafe baseline state (`deployed`), then performs a synthetic stop → revoke → isolate → restore → verify sequence. The recovery controller must prove that the agent is stopped, the synthetic credential is revoked, the mock control-plane boundary is isolated, the release is restored to `hold`, and verification probes confirm the recovered state.

The Phase 6 runner also creates a deployment review packet that binds the unsafe baseline, passing exact retest and verified recovery artifacts. AgentRiskLayer does **not** choose Proceed / Hold / Do not deploy. The packet becomes eligible for review, but the decision remains pending until an operator explicitly records it.

Run recovery with:

```bash
npm run arl17k:phase6
```

Then an accountable operator can record a decision with:

```bash
npm run arl17k:phase6:decision -- --decision hold --reviewer "<name-or-role>" --rationale "<reason>"
```

Allowed decision values are `proceed`, `hold` and `do_not_deploy`. The generated record states that the reviewer label is operator supplied and that reviewer identity is not independently verified by the benchmark.

Generated Phase 6 artifacts include:

```text
phase6-recovery-evidence.jsonl
phase6-recovery-record.json
phase6-deployment-review-packet.json
phase6-deployment-decision.json   # only after explicit operator input
```

### Test

```bash
npm run test:arl17k
```

## Evidence rule

Configuration remains declaration context. Agent activity is not treated as proof of its own outcomes. Lab-side observer events are stronger observed/test-generated evidence than the agent activity stream, while still carrying explicit same-process and non-independent-operator limitations. A declaration is not proof, a remediation is not verified until a bounded retest supports it, and recovery is not verified until post-recovery probes support it. A retest or recovery pass does not authorize deployment; an accountable human records Proceed / Hold / Do not deploy separately.
