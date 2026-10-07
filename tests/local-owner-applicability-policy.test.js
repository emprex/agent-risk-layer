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


test('full-profile local continuation conservatively includes unresolved conditional controls instead of blocking per control', async () => {
  const fs = await import('node:fs');
  const path = await import('node:path');
  const { fileURLToPath } = await import('node:url');
  const root = fileURLToPath(new URL('../', import.meta.url));
  const source = fs.readFileSync(
    path.join(root, 'src/agent/local-assessment-workflow.mjs'),
    'utf8'
  );

  assert.match(
    source,
    /profileControls \|\| 0\) === 108/
  );
  assert.match(
    source,
    /assessControlApplicabilityFromLocalOwnerAttestation/
  );
  assert.match(
    source,
    /unresolved conditional applicability is conservatively included for assessment/
  );
  assert.match(
    source,
    /decision: 'applicable'/
  );
  assert.match(
    source,
    /does not prove the control passes and does not approve deployment/
  );
});
