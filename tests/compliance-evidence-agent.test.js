import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildEvidenceCandidate,
  recordHumanEvidenceReview,
  summarizeControlEvidence
} from '../src/compliance-evidence-agent.js';

const digest = 'a'.repeat(64);

function candidate(overrides = {}) {
  return buildEvidenceCandidate({
    sourceType: 'github',
    sourceLocator: 'github://emprex/example/.github/workflows/ci.yml@abc123',
    collectedAt: '2026-10-02T19:00:00Z',
    contentDigest: digest,
    observedFacts: ['CI workflow exists', 'Tests run on pull requests'],
    proposedControlIds: ['CTRL-CI-001'],
    mappingRationale: 'The workflow is candidate evidence for change-validation activity.',
    limitations: 'Workflow configuration alone does not prove every run succeeded or that the control is satisfied.',
    ...overrides
  });
}

test('new evidence candidates always require human review and make no authority claim', () => {
  const item = candidate();
  assert.equal(item.reviewStatus, 'pending_human_review');
  assert.equal(item.authority, 'human_required');
  assert.equal(item.authorityLimitations.evidenceValidity, 'not_decided');
  assert.equal(item.authorityLimitations.controlSatisfaction, 'not_decided');
  assert.equal(item.id.startsWith('EV-CAND-'), true);
});

test('candidate identity is deterministic for the same provenance and mapping', () => {
  const first = candidate();
  const second = candidate();
  assert.equal(first.id, second.id);
  assert.equal(first.candidateDigest, second.candidateDigest);
});

test('authoritative caller claims are rejected at collection time', () => {
  assert.throws(() => candidate({ verified: true }), /must not set authoritative field: verified/);
  assert.throws(() => candidate({ controlSatisfied: true }), /must not set authoritative field: controlSatisfied/);
  assert.throws(() => candidate({ certified: true }), /must not set authoritative field: certified/);
});

test('human evidence acceptance does not decide control satisfaction', () => {
  const item = candidate();
  const review = recordHumanEvidenceReview(item, {
    outcome: 'accepted',
    reviewerId: 'human:reviewer-1',
    reason: 'The repository evidence is authentic and relevant to the stated evidence purpose.',
    reviewedAt: '2026-10-02T19:30:00Z'
  });

  assert.equal(review.outcome, 'accepted');
  assert.equal(review.candidateDigest, item.candidateDigest);
  assert.equal(review.controlSatisfaction, 'not_decided');
  assert.match(review.meaning, /does not decide control satisfaction/i);
});

test('gap summary distinguishes missing, pending and accepted evidence without compliance scoring', () => {
  const pending = candidate();
  const accepted = candidate({
    sourceLocator: 'github://emprex/example/settings/ruleset/main',
    contentDigest: 'b'.repeat(64),
    observedFacts: ['Main branch changes require pull requests'],
    mappingRationale: 'The repository ruleset is candidate evidence for protected change approval.'
  });

  const review = recordHumanEvidenceReview(accepted, {
    outcome: 'accepted',
    reviewerId: 'human:reviewer-1',
    reason: 'Ruleset provenance and repository scope were manually verified.',
    reviewedAt: '2026-10-02T19:45:00Z'
  });

  const summary = summarizeControlEvidence({
    controlIds: ['CTRL-CI-001', 'CTRL-ACCESS-001'],
    candidates: [pending, accepted],
    reviews: [review]
  });

  assert.deepEqual(summary, [
    {
      controlId: 'CTRL-CI-001',
      candidateCount: 2,
      evidenceStatus: 'accepted_evidence_exists',
      controlSatisfaction: 'not_decided',
      requiresHumanDecision: true
    },
    {
      controlId: 'CTRL-ACCESS-001',
      candidateCount: 0,
      evidenceStatus: 'no_candidate_evidence',
      controlSatisfaction: 'not_decided',
      requiresHumanDecision: true
    }
  ]);
});

test('review bound to an old candidate digest cannot silently carry forward', () => {
  const original = candidate();
  const review = recordHumanEvidenceReview(original, {
    outcome: 'accepted',
    reviewerId: 'human:reviewer-1',
    reason: 'Original candidate reviewed.',
    reviewedAt: '2026-10-02T19:45:00Z'
  });

  const changed = candidate({
    sourceLocator: 'github://emprex/example/.github/workflows/ci.yml@def456',
    contentDigest: 'c'.repeat(64)
  });

  const forgedReuse = { ...review, candidateId: changed.id };

  const [summary] = summarizeControlEvidence({
    controlIds: ['CTRL-CI-001'],
    candidates: [changed],
    reviews: [forgedReuse]
  });

  assert.equal(summary.evidenceStatus, 'pending_human_review');
});
