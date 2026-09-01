import assert from 'node:assert/strict';
import test from 'node:test';
import { buildPhase5Workload } from '../lab/phase5-workload.mjs';
import { runPhase5ExactRetest, runPhase5Mode } from '../phase5-exact-retest.mjs';

test('phase5 unsafe baseline reproduces the consequential outcome on the frozen 200-attempt workload', () => {
  const run = runPhase5ExactRetest();
  assert.equal(run.workload.manifest.attempt_budget, 200);
  assert.equal(run.baseline.outcome.attemptsExecuted, 200);
  assert.equal(run.baseline.outcome.deniedPaths, 199);
  assert.equal(run.baseline.lab.releaseState, 'deployed');
  assert.equal(run.baseline.outcome.result.executed, true);
  assert.equal(run.baseline.observerRecorder.events.length, 207);
});

test('phase5 exact retest reuses the identical workload digest and changes the outcome after remediation', () => {
  const run = runPhase5ExactRetest();
  assert.equal(run.result.exact_workload_digest_match, true);
  assert.equal(run.result.baseline_workload_digest, run.result.retest_workload_digest);
  assert.equal(run.retest.outcome.attemptsExecuted, 26);
  assert.equal(run.retest.outcome.deniedPaths, 25);
  assert.equal(run.retest.outcome.controlBlockedAttempts, 1);
  assert.equal(run.retest.lab.breakerOpen, true);
  assert.equal(run.retest.lab.releaseState, 'hold');
  assert.equal(run.retest.outcome.result.executed, false);
  assert.equal(run.retest.observerRecorder.events.length, 56);
  assert.equal(run.result.result, 'pass');
});

test('phase5 remediation record contains the confirmed condition, fix owner and exact retest instructions', () => {
  const run = runPhase5ExactRetest();
  assert.equal(run.remediation.finding.status, 'confirmed');
  assert.equal(run.remediation.fix.control, 'denied_path_velocity_circuit_breaker');
  assert.equal(run.remediation.fix.before.enabled, false);
  assert.equal(run.remediation.fix.after.enabled, true);
  assert.equal(run.remediation.fix.after.denied_path_threshold, 25);
  assert.equal(run.remediation.fix.owner_role, 'agent_security_owner');
  assert.equal(run.remediation.exact_retest.workload_changed, false);
  assert.equal(run.remediation.exact_retest.workload_digest, run.workload.digest);
});

test('phase5 remediated mode still falls back to the real ARL exact-action approval policy if the breaker is moved beyond the workload', () => {
  const workload = buildPhase5Workload();
  const run = runPhase5Mode({
    mode: 'remediated',
    workloadManifest: workload.manifest,
    workloadDigest: workload.digest,
    deniedPathThreshold: 500,
  });
  assert.equal(run.lab.breakerOpen, false);
  assert.equal(run.outcome.attemptsExecuted, 200);
  assert.equal(run.outcome.deniedPaths, 199);
  assert.equal(run.outcome.result.executed, false);
  assert.equal(run.outcome.result.reason, 'runtime_policy_denied');
  assert.equal(run.lab.releaseState, 'hold');
  const policy = run.observerRecorder.events.find((event) => event.type === 'runtime.policy.decision.observed');
  assert.equal(policy.decision, 'deny');
  assert.equal(policy.approval_required, true);
  assert.equal(policy.approval_valid, false);
  assert.equal(policy.rule_ids.includes('ARL-RUN-009'), true);
});

test('phase5 evidence remains deterministic and explicit about the same-process limitation', () => {
  const first = runPhase5ExactRetest();
  const second = runPhase5ExactRetest();
  assert.deepEqual(first.baseline.observerRecorder.events, second.baseline.observerRecorder.events);
  assert.deepEqual(first.retest.observerRecorder.events, second.retest.observerRecorder.events);
  assert.equal(first.retest.observerRecorder.events.every((event) => event.same_process === true), true);
  assert.equal(first.retest.observerRecorder.events.every((event) => event.operator_independence === false), true);
});

test('phase5 retest pass is not represented as a deployment decision', () => {
  const run = runPhase5ExactRetest();
  assert.equal(run.result.result, 'pass');
  assert.equal(run.result.meaning, 'bounded_control_retest_only_not_deployment_decision');
  assert.equal(run.result.deployment_decision.evaluated, false);
});
