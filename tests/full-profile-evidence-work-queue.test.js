import test from 'node:test';
import assert from 'node:assert/strict';

import {
  buildFullProfileEvidenceWorkQueue
} from '../src/agent/full-profile-evidence-work-queue.mjs';

function riskEntry(id, overrides = {}) {
  return {
    id,
    title: overrides.title || id,
    category: overrides.category || 'governance',
    claimsBoundary:
      overrides.claimsBoundary || 'Bound to observed evidence only.',
    checks: [
      {
        objective: 'Verify the control.',
        method: 'Inspect authoritative evidence.',
        requiredEvidence:
          overrides.requiredEvidence || ['authoritative evidence'],
        passCondition:
          overrides.passCondition || 'Evidence satisfies the control.',
        failCondition:
          overrides.failCondition || 'Evidence contradicts the control.'
      }
    ]
  };
}

test('full-profile evidence queue classifies safe automatic, persisted, human-only and inconclusive work', () => {
  const queue =
    buildFullProfileEvidenceWorkQueue({
      readiness: {
        summary: {
          profileControls: 108,
          applicableControls: 105,
          controlsMissingEvidence: 101
        }
      },
      riskKnowledge: {
        items: [
          riskEntry('ARL-KB-004'),
          riskEntry('ARL-KB-005'),
          riskEntry('ARL-KB-006'),
          riskEntry('ARL-KB-007')
        ]
      },
      controlIntelligence: {
        items: [
          {
            controlId: 'ARL-KB-004',
            currentStage: 'test',
            chainStatus: 'test_required',
            testMode: 'automated',
            automationStatus: 'verified'
          },
          {
            controlId: 'ARL-KB-005',
            currentStage: 'evidence',
            chainStatus: 'evidence_required',
            testMode: 'manual',
            automationStatus: 'unsupported'
          },
          {
            controlId: 'ARL-KB-006',
            currentStage: 'test',
            chainStatus: 'test_required',
            testMode: 'manual',
            automationStatus: 'unsupported'
          },
          {
            controlId: 'ARL-KB-007',
            currentStage: 'test',
            chainStatus: 'test_inconclusive',
            testMode: 'automated',
            automationStatus: 'verified'
          }
        ]
      }
    });

  assert.equal(queue.available, true);
  assert.equal(queue.profileControls, 108);
  assert.equal(queue.applicableControls, 105);
  assert.equal(queue.controlsMissingEvidence, 101);
  assert.deepEqual(queue.summary, {
    total: 4,
    machineObservable: 1,
    existingAuthoritativeEvidence: 1,
    humanOnly: 1,
    unavailableOrInconclusive: 1,
    humanReviewBatches: 1
  });

  assert.equal(
    queue.items[0].classification,
    'machine_observable'
  );
  assert.equal(
    queue.items[1].classification,
    'existing_authoritative_evidence'
  );
  assert.equal(
    queue.items[2].classification,
    'human_only'
  );
  assert.equal(
    queue.items[3].classification,
    'unavailable_or_inconclusive'
  );

  assert.deepEqual(
    queue.items[0].requiredEvidence,
    ['authoritative evidence']
  );
  assert.equal(
    queue.items[0].passCondition,
    'Evidence satisfies the control.'
  );
  assert.equal(
    queue.items[0].failCondition,
    'Evidence contradicts the control.'
  );
});

test('work queue is not exposed as authoritative outside the 108-control profile', () => {
  const queue =
    buildFullProfileEvidenceWorkQueue({
      readiness: {
        summary: {
          profileControls: 4
        }
      },
      controlIntelligence: {
        items: []
      },
      riskKnowledge: {
        items: []
      }
    });

  assert.equal(queue.available, false);
  assert.equal(queue.reason, 'full_profile_not_active');
  assert.deepEqual(queue.items, []);
});

test('controls already beyond evidence collection are not re-opened by the queue', () => {
  const queue =
    buildFullProfileEvidenceWorkQueue({
      readiness: {
        summary: {
          profileControls: 108,
          applicableControls: 105,
          controlsMissingEvidence: 1
        }
      },
      riskKnowledge: {
        items: [
          riskEntry('ARL-KB-001'),
          riskEntry('ARL-KB-004')
        ]
      },
      controlIntelligence: {
        items: [
          {
            controlId: 'ARL-KB-001',
            currentStage: 'deployment_decision',
            chainStatus: 'controlled_with_evidence'
          },
          {
            controlId: 'ARL-KB-004',
            currentStage: 'test',
            chainStatus: 'test_required',
            testMode: 'manual',
            automationStatus: 'unsupported'
          }
        ]
      }
    });

  assert.equal(queue.items.length, 1);
  assert.equal(queue.items[0].controlId, 'ARL-KB-004');
});


test('human-only controls with the same canonical evidence requirement are consolidated into one review batch', () => {
  const queue =
    buildFullProfileEvidenceWorkQueue({
      readiness: {
        summary: {
          profileControls: 108,
          applicableControls: 105,
          controlsMissingEvidence: 2
        }
      },
      riskKnowledge: {
        items: [
          riskEntry('ARL-KB-010', {
            requiredEvidence: [
              'Accountable owner declaration',
              'Documented review record'
            ]
          }),
          riskEntry('ARL-KB-011', {
            requiredEvidence: [
              'Accountable owner declaration',
              'Documented review record'
            ]
          })
        ]
      },
      controlIntelligence: {
        items: [
          {
            controlId: 'ARL-KB-010',
            currentStage: 'test',
            chainStatus: 'test_required',
            testMode: 'manual',
            automationStatus: 'unsupported'
          },
          {
            controlId: 'ARL-KB-011',
            currentStage: 'test',
            chainStatus: 'test_required',
            testMode: 'manual',
            automationStatus: 'unsupported'
          }
        ]
      }
    });

  assert.equal(queue.humanReviewBatches.length, 1);
  assert.deepEqual(
    queue.humanReviewBatches[0].controlIds,
    ['ARL-KB-010', 'ARL-KB-011']
  );
  assert.deepEqual(
    queue.humanReviewBatches[0].requirements,
    [
      'Accountable owner declaration',
      'Documented review record'
    ]
  );
  assert.match(
    queue.humanReviewBatches[0].reviewInstruction,
    /will not infer pass\/fail/
  );
});
