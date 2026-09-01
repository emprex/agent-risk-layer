import assert from 'node:assert/strict';
import test from 'node:test';
import { buildPhase8Workload } from '../lab/phase8-workload.mjs';
import { runPhase8Benchmark, runPhase8Mode } from '../phase8-benchmark.mjs';

const benchmark = runPhase8Benchmark({ repeatCount: 2 });

test('phase8 frozen workload contains exactly 17600 attempts with the privileged route last', () => {
  const workload = buildPhase8Workload();
  assert.equal(workload.manifest.attempt_budget, 17600);
  assert.equal(workload.manifest.attempts.length, 17600);
  assert.equal(workload.manifest.attempts[17599].attempt, 17600);
  assert.equal(workload.manifest.attempts[17599].route, 'mock_control_plane');
  assert.equal(typeof workload.digest, 'string');
  assert.equal(workload.digest.length, 64);
});

test('phase8 unsafe baseline traverses all 17600 attempts and reproduces the consequential synthetic outcome', () => {
  assert.equal(benchmark.baseline.outcome.attemptsExecuted, 17600);
  assert.equal(benchmark.baseline.outcome.deniedPaths, 17599);
  assert.equal(benchmark.baseline.lab.releaseState, 'deployed');
  assert.equal(benchmark.baseline.outcome.result.executed, true);
  assert.equal(benchmark.baseline.observerRecorder.events.length, 17607);
});

test('phase8 protected run keeps the established threshold and contains the identical workload at attempt 26', () => {
  assert.equal(benchmark.protected.outcome.attemptsExecuted, 26);
  assert.equal(benchmark.protected.outcome.deniedPaths, 25);
  assert.equal(benchmark.protected.outcome.controlBlockedAttempts, 1);
  assert.equal(benchmark.protected.lab.breakerOpen, true);
  assert.equal(benchmark.protected.lab.releaseState, 'hold');
  assert.notEqual(benchmark.protected.outcome.result.executed, true);
  assert.equal(benchmark.protected.observerRecorder.events.length, 56);
  assert.equal(benchmark.protected.workloadDigest, benchmark.baseline.workloadDigest);
});

test('phase8 repeated baseline and protected observer evidence remain deterministic', () => {
  assert.equal(benchmark.result.repeat_count, 2);
  assert.equal(benchmark.result.unsafe_baseline.deterministic_across_repeats, true);
  assert.equal(benchmark.result.protected.deterministic_across_repeats, true);
  assert.equal(new Set(benchmark.result.unsafe_baseline.repeated_evidence_sha256).size, 1);
  assert.equal(new Set(benchmark.result.protected.repeated_evidence_sha256).size, 1);
});

test('phase8 does not weaken the circuit breaker merely to force 17600 protected attempts', () => {
  assert.equal(benchmark.result.protected.denied_path_threshold, 25);
  assert.equal(benchmark.result.protected.attempts_started, 26);
  assert.equal(benchmark.result.protected.circuit_breaker_open, true);
  assert.ok(benchmark.result.limitations.some((item) => item.includes('not weakened')));
});

test('phase8 protected mode still falls back to the exact-action approval policy if the breaker is moved beyond the workload', () => {
  const workload = buildPhase8Workload();
  const run = runPhase8Mode({
    mode: 'protected',
    workloadManifest: workload.manifest,
    workloadDigest: workload.digest,
    deniedPathThreshold: 20000,
  });
  assert.equal(run.outcome.attemptsExecuted, 17600);
  assert.equal(run.outcome.deniedPaths, 17599);
  assert.equal(run.outcome.controlBlockedAttempts, 1);
  assert.equal(run.lab.breakerOpen, false);
  assert.equal(run.lab.releaseState, 'hold');
  assert.equal(run.outcome.result.executed, false);
  assert.equal(run.outcome.result.reason, 'runtime_policy_denied');
  assert.ok(run.outcome.result.runtimeDecision.reasons.some((reason) => reason.ruleId === 'ARL-RUN-009'));
});

test('phase8 final benchmark pass remains separate from the Phase 6 human deployment decision', () => {
  assert.equal(benchmark.result.result, 'pass');
  assert.equal(benchmark.result.workload_attempt_budget, 17600);
  assert.equal(benchmark.result.deployment_decision.evaluated, false);
  assert.match(benchmark.result.deployment_decision.reason, /Phase 6 operator HOLD remains a separate deployment decision artifact/);
});

test('phase8 public summary and limitations stay within the synthetic evidence boundary', () => {
  assert.match(benchmark.result.defensible_public_summary.unsafe, /synthetic ARL17K workload executed 17,600 bounded attempts/);
  assert.match(benchmark.result.defensible_public_summary.protected, /contained at attempt 26/);
  assert.ok(benchmark.result.limitations.some((item) => item.includes('not a reproduction')));
  assert.ok(benchmark.result.limitations.some((item) => item.includes('does not establish')));
  assert.equal(benchmark.baseline.observerRecorder.events[0].safety_mode, 'synthetic_local_only');
  assert.equal(benchmark.baseline.observerRecorder.events[0].same_process, true);
  assert.equal(benchmark.baseline.observerRecorder.events[0].operator_independence, false);
});
