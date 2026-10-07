import test from 'node:test';
import assert from 'node:assert/strict';

import {
  parseLocalApplicabilityCommand,
  localApplicabilityCandidateIds,
  focusLocalApplicabilityControl
} from '../src/agent/local-applicability-command.mjs';

import {
  recordControlApplicabilityConfirmation
} from '../src/agent/control-applicability-handoff.mjs';

test('positive applicability shorthand fails closed without a human rationale', () => {
  assert.throws(
    () => parseLocalApplicabilityCommand('Control ARL-KB-057 applies'),
    /specific human rationale/i
  );
});

test('parses an explicit applicable decision with a human rationale', () => {
  assert.deepEqual(
    parseLocalApplicabilityCommand(
      'Set control applicability {"controlId":"ARL-KB-001","decision":"applicable","reason":"The frozen agent exposes general MCP tool authority within the assessed scope."}'
    ),
    {
      controlId: 'ARL-KB-001',
      decision: 'applicable',
      reason: 'The frozen agent exposes general MCP tool authority within the assessed scope.',
      architectureFactIds: null
    }
  );
});

test('authoritative handoff refuses to invent an applicable rationale', async () => {
  const result = await recordControlApplicabilityConfirmation({
    projectId: 'prj_regression',
    userId: 'usr_regression',
    decision: 'applicable',
    reason: ''
  });

  assert.equal(result.available, false);
  assert.equal(
    result.reason,
    'guided_customer_applicability_reason_required'
  );
});

test('parses explicit not-applicable decisions with human rationale and confirmed facts', () => {
  assert.deepEqual(
    parseLocalApplicabilityCommand(
      'Set control applicability {"controlId":"ARL-KB-046","decision":"not_applicable","reason":"The frozen target has no cross-session agent memory.","architectureFactIds":["memory:no_cross_session_persistence"]}'
    ),
    {
      controlId: 'ARL-KB-046',
      decision: 'not_applicable',
      reason: 'The frozen target has no cross-session agent memory.',
      architectureFactIds: ['memory:no_cross_session_persistence']
    }
  );
});

test('parses context-required decisions without inventing facts', () => {
  assert.deepEqual(
    parseLocalApplicabilityCommand(
      'Set control applicability {"controlId":"ARL-KB-090","decision":"context_required","reason":"Audit reconstruction scope needs further human review."}'
    ),
    {
      controlId: 'ARL-KB-090',
      decision: 'context_required',
      reason: 'Audit reconstruction scope needs further human review.',
      architectureFactIds: null
    }
  );
});

test('not-applicable decisions fail closed without a supporting confirmed fact', () => {
  assert.throws(
    () => parseLocalApplicabilityCommand(
      'Set control applicability {"controlId":"ARL-KB-046","decision":"not_applicable","reason":"No persistent memory is present."}'
    ),
    /requires at least one confirmed supporting architecture fact/i
  );
});

test('invalid decisions fail closed', () => {
  assert.throws(
    () => parseLocalApplicabilityCommand(
      'Set control applicability {"controlId":"ARL-KB-057","decision":"probably","reason":"This is deliberately invalid."}'
    ),
    /decision must be applicable, not_applicable, or context_required/i
  );
});


test('local review exposes only the currently scoped applicability control', () => {
  assert.deepEqual(
    localApplicabilityCandidateIds({
      stage: 'control_applicability_required',
      scopedControl: { controlId: 'ARL-KB-057' },
      authoritativeArtifacts: {
        controlIntelligence: {
          relevantControls: [
            { controlId: 'ARL-KB-046', currentStage: 'applicability' },
            { controlId: 'ARL-KB-057', currentStage: 'applicability' }
          ]
        },
        evidencePlan: {
          mappedControls: [
            { controlId: 'ARL-KB-057' }
          ]
        }
      }
    }),
    ['ARL-KB-057']
  );
});

test('local review filters applicability ambiguity to Evidence Plan mapped controls', () => {
  assert.deepEqual(
    localApplicabilityCandidateIds({
      stage: 'persisted_lineage_resolution_required',
      authoritativeArtifacts: {
        controlIntelligence: {
          relevantControls: [
            { controlId: 'ARL-KB-046', currentStage: 'applicability' },
            { controlId: 'ARL-KB-057', currentStage: 'applicability' },
            { controlId: 'ARL-KB-090', currentStage: 'applicability' },
            { controlId: 'ARL-KB-100', currentStage: 'applicability' }
          ]
        },
        evidencePlan: {
          mappedControls: [
            { controlId: 'ARL-KB-057' },
            { controlId: 'ARL-KB-090' }
          ]
        }
      }
    }),
    ['ARL-KB-057', 'ARL-KB-090']
  );
});


test('focuses any canonical control at applicability on the current authoritative snapshot', () => {
  const workflowState = {
    schema: 'arl.agent.workflow-state.v1',
    available: true,
    stage: 'readiness_review',
    blocked: true,
    canAutoAdvance: false,
    authoritativeArtifacts: {
      assessmentContext: {
        systemSnapshotId: 'sys_current'
      },
      evidencePlan: {
        mappedControls: [
          { controlId: 'ARL-KB-046' },
          { controlId: 'ARL-KB-057' },
          { controlId: 'ARL-KB-090' },
          { controlId: 'ARL-KB-100' }
        ]
      }
    },
    deploymentDecisionWritten: false,
    humanReviewRequired: true
  };

  const focused = focusLocalApplicabilityControl(
    workflowState,
    {
      systemSnapshot: { id: 'sys_current' },
      control: { id: 'ARL-KB-001' },
      chain: {
        currentStage: 'applicability',
        status: 'context_required',
        nextAction: 'Confirm applicability.',
        deploymentImpact: 'hold'
      }
    },
    'ARL-KB-001'
  );

  assert.equal(focused.stage, 'control_applicability_required');
  assert.equal(focused.scopedControl.controlId, 'ARL-KB-001');
  assert.equal(focused.nextAllowedAction.name, 'resolve_control_applicability');
  assert.equal(focused.nextAllowedAction.actor, 'user');
  assert.equal(focused.deploymentDecisionWritten, false);
  assert.equal(focused.humanReviewRequired, true);
});

test('generic control focus fails closed on stale snapshot or non-applicability stage', () => {
  const workflowState = {
    authoritativeArtifacts: {
      assessmentContext: {
        systemSnapshotId: 'sys_current'
      }
    }
  };

  assert.equal(
    focusLocalApplicabilityControl(
      workflowState,
      {
        systemSnapshot: { id: 'sys_old' },
        control: { id: 'ARL-KB-001' },
        chain: { currentStage: 'applicability' }
      },
      'ARL-KB-001'
    ),
    null
  );

  assert.equal(
    focusLocalApplicabilityControl(
      workflowState,
      {
        systemSnapshot: { id: 'sys_current' },
        control: { id: 'ARL-KB-001' },
        chain: { currentStage: 'test' }
      },
      'ARL-KB-001'
    ),
    null
  );
});
