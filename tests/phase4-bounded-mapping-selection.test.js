import test from 'node:test';
import assert from 'node:assert/strict';

process.env.NODE_ENV = 'test';
process.env.SESSION_SECRET ||= 'phase4-bounded-mapping-selection-test-secret-1234567890';

const {
  selectBoundedEvidencePlanMapping
} = await import('../src/agent/bounded-redteam-handoff.mjs');

function workflowState({ action = {}, mappings = [], controls = [] } = {}) {
  return {
    nextAllowedAction: {
      name: 'authorise_and_run_bounded_test',
      actor: 'user',
      requiresUserInput: true,
      controlId: null,
      caseId: null,
      ...action
    },
    authoritativeArtifacts: {
      evidencePlan: {
        mappedControls: mappings
      },
      controlIntelligence: {
        relevantControls: controls
      }
    }
  };
}

test('selects the first stable authoritative test control when paginated fallback has no scope', () => {
  const state = workflowState({
    mappings: [
      { controlId: 'ARL-KB-090', caseId: 'RT-PI-090' },
      { controlId: 'ARL-KB-057', caseId: 'RT-PI-057' }
    ],
    controls: [
      { controlId: 'ARL-KB-090', currentStage: 'test', authorityProjection: true },
      { controlId: 'ARL-KB-057', currentStage: 'test', authorityProjection: true }
    ]
  });

  assert.deepEqual(
    selectBoundedEvidencePlanMapping(state),
    { controlId: 'ARL-KB-057', caseId: 'RT-PI-057' }
  );
});

test('honours an authoritative action scope when one is already present', () => {
  const state = workflowState({
    action: { controlId: 'ARL-KB-090', caseId: 'RT-PI-090' },
    mappings: [
      { controlId: 'ARL-KB-057', caseId: 'RT-PI-057' },
      { controlId: 'ARL-KB-090', caseId: 'RT-PI-090' }
    ],
    controls: [
      { controlId: 'ARL-KB-057', currentStage: 'test', authorityProjection: true },
      { controlId: 'ARL-KB-090', currentStage: 'test', authorityProjection: true }
    ]
  });

  assert.equal(selectBoundedEvidencePlanMapping(state)?.caseId, 'RT-PI-090');
});

test('remains fail-closed when one control maps to multiple bounded cases', () => {
  const state = workflowState({
    mappings: [
      { controlId: 'ARL-KB-057', caseId: 'RT-PI-057-A' },
      { controlId: 'ARL-KB-057', caseId: 'RT-PI-057-B' }
    ],
    controls: [
      { controlId: 'ARL-KB-057', currentStage: 'test', authorityProjection: true }
    ]
  });

  assert.equal(selectBoundedEvidencePlanMapping(state), null);
});

test('never selects a test mapping without exact authority projection', () => {
  const state = workflowState({
    mappings: [
      { controlId: 'ARL-KB-057', caseId: 'RT-PI-057' }
    ],
    controls: [
      { controlId: 'ARL-KB-057', currentStage: 'test', authorityProjection: false }
    ]
  });

  assert.equal(selectBoundedEvidencePlanMapping(state), null);
});
