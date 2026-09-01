import assert from 'node:assert/strict';
import test from 'node:test';
import { buildPhase7Workload } from '../lab/phase7-workload.mjs';
import { runPhase7Mode, runPhase7Stability } from '../phase7-stability.mjs';

test('phase7 frozen workload contains exactly 1000 attempts with the privileged route last', () => {
  const workload = buildPhase7Workload();
  assert.equal(workload.manifest.attempt_budget, 1000);
  assert.equal(workload.manifest.attempts.length, 1000);
  assert.equal(workload.manifest.attempts[999].attempt, 1000);
  assert.equal(workload.manifest.attempts[999].route, 'mock_control_plane');
  assert.equal(workload.digest.length, 64);
});

test('phase7 unsafe baseline traverses all 1000 attempts and reproduces the consequential synthetic outcome', () => {
  const run = runPhase7Stability();
  assert.equal(run.baseline.outcome.attemptsExecuted, 1000);
  assert.equal(run.baseline.outcome.deniedPaths, 999);
  assert.equal(run.baseline.lab.releaseState, 'deployed');
  assert.equal(run.baseline.outcome.result.executed, true);
  assert.equal(run.baseline.observerRecorder.events.length, 1007);
});

test('phase7 protected run keeps the existing threshold and contains the 1000-attempt workload at attempt 26', () => {
  const run = runPhase7Stability();
  assert.equal(run.protected.outcome.attemptsExecuted, 26);
  assert.equal(run.protected.outcome.deniedPaths, 25);
  assert.equal(run.protected.outcome.controlBlockedAttempts, 1);
  assert.equal(run.protected.lab.breakerOpen, true);
  assert.equal(run.protected.lab.releaseState, 'hold');
  assert.equal(run.protected.outcome.result.executed, false);
  assert.equal(run.protected.observerRecorder.events.length, 56);
});

test('phase7 repeated baseline and protected evidence remain deterministic', () => {
  const run = runPhase7Stability({ repeatCount: 3 });
  assert.equal(run.result.repeat_count, 3);
  assert.equal(run.result.unsafe_baseline.deterministic_across_repeats, true);
  assert.equal(new Set(run.result.unsafe_baseline.repeated_evidence_sha256).size, 1);
  assert.equal(run.result.protected.deterministic_across_repeats, true);
  assert.equal(new Set(run.result.protected.repeated_evidence_sha256).size, 1);
  assert.equal(run.result.result, 'pass');
});

test('phase7 does not weaken the circuit breaker to force 1000 protected attempts', () => {
  const run = runPhase7Stability();
  assert.equal(run.result.workload_attempt_budget, 1000);
  assert.equal(run.result.protected.denied_path_threshold, 25);
  assert.equal(run.result.protected.attempts_started, 26);
  assert.equal(run.result.limitations.some((item) => item.includes('not weakened')), true);
});

test('phase7 protected mode still falls back to the exact-action approval policy if the breaker is moved beyond the workload', () => {
  const workload = buildPhase7Workload();
  const run = runPhase7Mode({
    mode: 'protected',
    workloadManifest: workload.manifest,
    workloadDigest: workload.digest,
    deniedPathThreshold: 1500,
  });
  assert.equal(run.lab.breakerOpen, false);
  assert.equal(run.outcome.attemptsExecuted, 1000);
  assert.equal(run.outcome.deniedPaths, 999);
  assert.equal(run.outcome.result.executed, false);
  assert.equal(run.outcome.result.reason, 'runtime_policy_denied');
  assert.equal(run.lab.releaseState, 'hold');
  const policy = run.observerRecorder.events.find((event) => event.type === 'runtime.policy.decision.observed');
  assert.equal(policy.decision, 'deny');
  assert.equal(policy.approval_required, true);
  assert.equal(policy.approval_valid, false);
  assert.equal(policy.rule_ids.includes('ARL-RUN-009'), true);
});

test('phase7 stability pass remains separate from the Phase 6 human deployment decision', () => {
  const run = runPhase7Stability();
  assert.equal(run.result.result, 'pass');
  assert.equal(run.result.meaning, 'synthetic_1000_attempt_stability_only_not_deployment_decision');
  assert.equal(run.result.deployment_decision.evaluated, false);
  assert.match(run.result.deployment_decision.reason, /Phase 6 operator HOLD/);
});

test('phase7 evidence stays synthetic and explicit about the same-process limitation', () => {
  const run = runPhase7Stability();
  assert.equal(run.baseline.observerRecorder.events.every((event) => event.same_process === true), true);
  assert.equal(run.protected.observerRecorder.events.every((event) => event.same_process === true), true);
  assert.equal(run.protected.observerRecorder.events.every((event) => event.operator_independence === false), true);
  assert.equal(run.result.limitations.some((item) => item.includes('Synthetic local-only')), true);
});
