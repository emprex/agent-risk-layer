import test from 'node:test';
import assert from 'node:assert/strict';

import {
  deriveAuthoritativeWorkflowState
} from '../src/agent/authoritative-workflow-state.mjs';

function preparation() {
  return {
    target: { revision: 'b3116fcfcec3bf6967773c3e9587c502b1fed5e5' },
    inspectorBinding: { verified: true },
    assessmentContext: {
      available: true,
      projectId: 'prj_test',
      systemSnapshotId: 'sys_current',
      systemSnapshotStatus: 'current'
    },
    authoritativeAssessment: {
      available: true,
      assessmentId: 'asm_test'
    },
    targetContextBinding: { verified: true },
    assessmentContextBinding: { verified: true },
    evidencePlan: {
      available: true,
      state: 'bounded-check-required',
      checks: [
        {
          id: 'egress-boundary',
          caseId: 'RT-TOOL-004',
          gap: { questionId: 'egress_control' }
        }
      ],
      manual: []
    }
  };
}

function item(controlId, currentStage, metadata = {}) {
  return {
    ...metadata,
    controlId,
    currentStage,
    chainStatus:
      currentStage === 'deployment_decision'
        ? 'controlled_with_evidence'
        : currentStage === 'test'
          ? 'test_required'
          : 'context_required',
    nextAction: `Next for ${controlId}`,
    deploymentImpact:
      currentStage === 'deployment_decision'
        ? 'satisfied'
        : 'hold',
    availableActions: []
  };
}

test('full-profile workflow continues an explicitly scoped unmapped control before readiness', () => {
  const state = deriveAuthoritativeWorkflowState({
    projectId: 'prj_test',
    userId: 'usr_test',
    assessmentId: 'asm_test',
    preparation: preparation(),
    controlIntelligence: {
      systemSnapshot: { id: 'sys_current' },
      items: [
        item('ARL-KB-046', 'deployment_decision'),
        item('ARL-KB-057', 'deployment_decision'),
        item('ARL-KB-090', 'deployment_decision'),
        item('ARL-KB-100', 'deployment_decision'),
        item('ARL-KB-001', 'test', {
          testMode: 'automated',
          automationStatus: 'verified'
        }),
        item('ARL-KB-002', 'applicability')
      ]
    },
    readiness: {
      available: true,
      decision: 'hold',
      systemSnapshotId: 'sys_current'
    }
  });

  assert.equal(state.stage, 'control_test_required');
  assert.equal(state.scopedControl.controlId, 'ARL-KB-001');
  assert.equal(state.nextAllowedAction.controlId, 'ARL-KB-001');
  assert.equal(state.nextAllowedAction.name, 'run_authoritative_control_test');
  assert.equal(state.nextAllowedAction.actor, 'arl');
  assert.equal(state.nextAllowedAction.requiresUserInput, false);
  assert.equal(state.nextAllowedAction.caseId, null);
});

test('after current scoped work completes, next untouched canonical control is offered for human applicability review', () => {
  const state = deriveAuthoritativeWorkflowState({
    projectId: 'prj_test',
    userId: 'usr_test',
    assessmentId: 'asm_test',
    preparation: preparation(),
    controlIntelligence: {
      systemSnapshot: { id: 'sys_current' },
      items: [
        item('ARL-KB-001', 'deployment_decision'),
        item('ARL-KB-046', 'deployment_decision'),
        item('ARL-KB-057', 'deployment_decision'),
        item('ARL-KB-090', 'deployment_decision'),
        item('ARL-KB-100', 'deployment_decision'),
        item('ARL-KB-003', 'applicability'),
        item('ARL-KB-002', 'applicability')
      ]
    },
    readiness: {
      available: true,
      decision: 'hold',
      systemSnapshotId: 'sys_current'
    }
  });

  assert.equal(state.stage, 'control_applicability_required');
  assert.equal(state.scopedControl.controlId, 'ARL-KB-002');
  assert.equal(state.nextAllowedAction.name, 'resolve_control_applicability');
  assert.equal(state.nextAllowedAction.actor, 'user');
  assert.equal(state.nextAllowedAction.requiresUserInput, true);
  assert.equal(state.deploymentDecisionWritten, false);
  assert.equal(state.humanReviewRequired, true);
});


test('ordinary source-backed control test is automatic while bounded tests still require explicit user authorisation', () => {
  const ordinary = deriveAuthoritativeWorkflowState({
    projectId: 'prj_test',
    userId: 'usr_test',
    assessmentId: 'asm_test',
    preparation: preparation(),
    controlIntelligence: {
      systemSnapshot: { id: 'sys_current' },
      items: [item('ARL-KB-001', 'test', {
        testMode: 'automated',
        automationStatus: 'verified'
      })]
    },
    readiness: {
      available: true,
      decision: 'hold',
      systemSnapshotId: 'sys_current'
    }
  });

  assert.equal(ordinary.nextAllowedAction.name, 'run_authoritative_control_test');
  assert.equal(ordinary.nextAllowedAction.actor, 'arl');
  assert.equal(ordinary.nextAllowedAction.requiresUserInput, false);
});


test('inconclusive automatic source review stops auto-loop and requests only missing evidence', () => {
  const state = deriveAuthoritativeWorkflowState({
    projectId: 'prj_test',
    userId: 'usr_test',
    assessmentId: 'asm_test',
    preparation: preparation(),
    controlIntelligence: {
      systemSnapshot: { id: 'sys_current' },
      items: [
        {
          ...item('ARL-KB-001', 'test', {
            testMode: 'automated',
            automationStatus: 'verified'
          }),
          chainStatus: 'test_inconclusive',
          nextAction: 'Resolve the inconclusive test with additional evidence or rerun it.'
        }
      ]
    },
    readiness: {
      available: true,
      decision: 'hold',
      systemSnapshotId: 'sys_current'
    }
  });

  assert.equal(state.stage, 'manual_evidence_required');
  assert.equal(state.scopedControl.controlId, 'ARL-KB-001');
  assert.equal(state.nextAllowedAction.name, 'provide_required_manual_evidence');
  assert.equal(state.nextAllowedAction.actor, 'user');
  assert.equal(state.nextAllowedAction.requiresUserInput, true);
  assert.equal(state.canAutoAdvance, false);
});

test('ordinary automatic control test does not falsely advertise a user blocker', () => {
  const state = deriveAuthoritativeWorkflowState({
    projectId: 'prj_test',
    userId: 'usr_test',
    assessmentId: 'asm_test',
    preparation: preparation(),
    controlIntelligence: {
      systemSnapshot: { id: 'sys_current' },
      items: [item('ARL-KB-001', 'test', {
        testMode: 'automated',
        automationStatus: 'verified'
      })]
    },
    readiness: {
      available: true,
      decision: 'hold',
      systemSnapshotId: 'sys_current'
    }
  });

  assert.equal(state.nextAllowedAction.actor, 'arl');
  assert.equal(state.nextAllowedAction.requiresUserInput, false);
  assert.equal(state.blockers.length, 0);
  assert.equal(state.blocked, false);
  assert.equal(state.canAutoAdvance, true);
});


test('manual unsupported controls never enter fake automatic source-test loops', () => {
  const state = deriveAuthoritativeWorkflowState({
    projectId: 'prj_test',
    userId: 'usr_test',
    assessmentId: 'asm_test',
    preparation: preparation(),
    controlIntelligence: {
      systemSnapshot: { id: 'sys_current' },
      items: [
        item('ARL-KB-001', 'test', {
          testMode: 'manual',
          automationStatus: 'unsupported'
        })
      ]
    },
    readiness: {
      available: true,
      decision: 'hold',
      systemSnapshotId: 'sys_current'
    }
  });

  assert.equal(state.stage, 'manual_evidence_required');
  assert.equal(state.nextAllowedAction.name, 'provide_required_manual_evidence');
  assert.equal(state.nextAllowedAction.actor, 'user');
  assert.equal(state.nextAllowedAction.requiresUserInput, true);
  assert.equal(state.canAutoAdvance, false);
});

test('candidate automation is not treated as verified executable automation', () => {
  const state = deriveAuthoritativeWorkflowState({
    projectId: 'prj_test',
    userId: 'usr_test',
    assessmentId: 'asm_test',
    preparation: preparation(),
    controlIntelligence: {
      systemSnapshot: { id: 'sys_current' },
      items: [
        item('ARL-KB-031', 'test', {
          testMode: 'hybrid',
          automationStatus: 'candidate'
        })
      ]
    },
    readiness: {
      available: true,
      decision: 'hold',
      systemSnapshotId: 'sys_current'
    }
  });

  assert.equal(state.stage, 'manual_evidence_required');
  assert.equal(state.nextAllowedAction.name, 'provide_required_manual_evidence');
  assert.equal(state.canAutoAdvance, false);
});
