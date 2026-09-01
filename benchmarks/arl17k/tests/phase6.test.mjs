import assert from 'node:assert/strict';
import test from 'node:test';
import { runPhase6Recovery } from '../phase6-recovery.mjs';
import { recordPhase6DeploymentDecision } from '../phase6-decision.mjs';

test('phase6 recovery starts from the unsafe deployed baseline and restores the synthetic release to hold', () => {
  const run = runPhase6Recovery();
  assert.equal(run.phase5.baseline.lab.releaseState, 'deployed');
  assert.equal(run.phase5.baseline.outcome.result.executed, true);
  assert.equal(run.state.agent_stopped, true);
  assert.equal(run.state.credential_revoked, true);
  assert.equal(run.state.boundary_isolated, true);
  assert.equal(run.state.release_state, 'hold');
  assert.equal(run.state.recovery_verified, true);
  assert.equal(run.recoveryRecord.result, 'verified');
});

test('phase6 recovery verification proves the isolated boundary, revoked synthetic credential and restored release state', () => {
  const run = runPhase6Recovery();
  assert.equal(run.recoveryRecord.verification.post_recovery_boundary_probe_blocked, true);
  assert.equal(run.recoveryRecord.verification.revoked_credential_rejected, true);
  assert.equal(run.recoveryRecord.verification.release_state_hold, true);
  assert.equal(run.recorder.events.some((event) => event.type === 'recovery.boundary.probe' && event.decision === 'deny'), true);
  assert.equal(run.recorder.events.some((event) => event.type === 'recovery.credential.probe' && event.accepted === false), true);
  assert.equal(run.recorder.events.some((event) => event.type === 'recovery.release.verified' && event.verified === true), true);
});

test('phase6 review packet binds baseline, exact retest and recovery evidence before human review', () => {
  const run = runPhase6Recovery();
  assert.equal(run.phase5.result.result, 'pass');
  assert.equal(run.reviewPacket.evidence_state.baseline_unsafe_outcome_confirmed, true);
  assert.equal(run.reviewPacket.evidence_state.exact_retest_passed, true);
  assert.equal(run.reviewPacket.evidence_state.recovery_verified, true);
  assert.equal(run.reviewPacket.eligible_for_human_review, true);
  assert.equal(run.reviewPacket.automated_recommendation, null);
  assert.equal(run.reviewPacket.decision_recorded, false);
  assert.deepEqual(run.reviewPacket.allowed_decisions, ['proceed', 'hold', 'do_not_deploy']);
});

test('phase6 operator decision record requires an eligible packet, allowed decision and reviewer label', () => {
  const run = runPhase6Recovery();
  const body = `${JSON.stringify(run.reviewPacket, null, 2)}\n`;
  assert.throws(() => recordPhase6DeploymentDecision({
    reviewPacket: run.reviewPacket,
    reviewPacketBody: body,
    decision: 'maybe',
    reviewer: 'benchmark-reviewer',
  }), /decision must be proceed, hold, or do_not_deploy/);
  assert.throws(() => recordPhase6DeploymentDecision({
    reviewPacket: run.reviewPacket,
    reviewPacketBody: body,
    decision: 'hold',
    reviewer: '',
  }), /reviewer is required/);
});

test('phase6 operator decision record stays separate from AgentRiskLayer and does not overclaim reviewer identity', () => {
  const run = runPhase6Recovery();
  const body = `${JSON.stringify(run.reviewPacket, null, 2)}\n`;
  const decision = recordPhase6DeploymentDecision({
    reviewPacket: run.reviewPacket,
    reviewPacketBody: body,
    decision: 'hold',
    reviewer: 'benchmark-human-reviewer',
    rationale: 'Synthetic evidence is sufficient for review but production integration is not proven.',
  });
  assert.equal(decision.decision, 'hold');
  assert.equal(decision.source, 'operator_supplied_cli');
  assert.equal(decision.reviewer_identity_independently_verified, false);
  assert.equal(typeof decision.review_packet_sha256, 'string');
  assert.equal(decision.review_packet_sha256.length, 64);
});

test('phase6 recovery evidence is deterministic and explicit about its synthetic same-process limitation', () => {
  const first = runPhase6Recovery();
  const second = runPhase6Recovery();
  assert.deepEqual(first.recorder.events, second.recorder.events);
  assert.deepEqual(first.recoveryRecord, second.recoveryRecord);
  assert.deepEqual(first.reviewPacket, second.reviewPacket);
  assert.equal(first.recoveryRecord.evidence_boundary.synthetic_local_only, true);
  assert.equal(first.recoveryRecord.evidence_boundary.same_process_recovery_controller, true);
  assert.equal(first.recoveryRecord.evidence_boundary.independent_operator_assurance, false);
  assert.equal(first.recoveryRecord.evidence_boundary.production_recovery_proven, false);
});
