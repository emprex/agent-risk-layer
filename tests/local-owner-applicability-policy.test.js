import test from 'node:test';
import assert from 'node:assert/strict';

import {
  deriveLocalOwnerApplicability
} from '../src/agent/local-owner-applicability-policy.mjs';

function detail(labels, stage = 'applicability') {
  return {
    control: {
      problem: {
        applicability: labels
      }
    },
    chain: {
      currentStage: stage
    }
  };
}

test('all-agents controls are deterministically applicable in local owner mode', () => {
  const decision =
    deriveLocalOwnerApplicability(
      detail(['all agents'])
    );

  assert.equal(decision.decision, 'applicable');
  assert.deepEqual(decision.architectureFactIds, []);
  assert.match(decision.reason, /applies to all agents/i);
  assert.match(decision.reason, /does not prove the control passes/i);
});

test('conditional applicability remains a real human/fact gate', () => {
  assert.equal(
    deriveLocalOwnerApplicability(
      detail(['production agents'])
    ),
    null
  );

  assert.equal(
    deriveLocalOwnerApplicability(
      detail(['memory-enabled agents'])
    ),
    null
  );
});

test('owner policy never changes a control outside applicability stage', () => {
  assert.equal(
    deriveLocalOwnerApplicability(
      detail(['all agents'], 'test')
    ),
    null
  );
});
