import crypto from 'node:crypto';

const ALLOWED_DECISIONS = new Set(['proceed', 'hold', 'do_not_deploy']);

function sha256(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

export function recordPhase6DeploymentDecision({ reviewPacket, reviewPacketBody, decision, reviewer, rationale = '' }) {
  if (!reviewPacket || reviewPacket.eligible_for_human_review !== true) {
    throw new Error('Deployment review packet is not eligible for human review.');
  }
  if (!ALLOWED_DECISIONS.has(decision)) {
    throw new Error('decision must be proceed, hold, or do_not_deploy.');
  }
  if (typeof reviewer !== 'string' || reviewer.trim().length === 0) {
    throw new Error('reviewer is required.');
  }
  if (typeof reviewPacketBody !== 'string' || reviewPacketBody.length === 0) {
    throw new Error('reviewPacketBody is required for evidence binding.');
  }

  return {
    schema: 'arl17k.deployment_decision.v1',
    benchmark_version: reviewPacket.benchmark_version,
    review_id: reviewPacket.review_id,
    decision,
    reviewer: reviewer.trim(),
    rationale: String(rationale || '').trim(),
    source: 'operator_supplied_cli',
    reviewer_identity_independently_verified: false,
    review_packet_sha256: sha256(reviewPacketBody),
    evidence: reviewPacket.evidence,
    evidence_state: reviewPacket.evidence_state,
    statement: 'This record captures an operator-supplied deployment decision. AgentRiskLayer does not make the deployment decision and does not independently verify the reviewer identity in this benchmark.',
  };
}
