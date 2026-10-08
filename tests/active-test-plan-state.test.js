import test from 'node:test';
import assert from 'node:assert/strict';

import {
  deriveAuthoritativeWorkflowState
} from '../src/agent/authoritative-workflow-state.mjs';

test('authorised plan evidence advances the workflow to execution', () => {
  const state = deriveAuthoritativeWorkflowState({
    projectId: 'prj_test',
    userId: 'usr_test',
    assessmentId: 'asm_test',
    preparation: {
      target: { revision: 'abc' },
      inspectorBinding: { verified: true },
      assessmentContext: {
        available: true,
        projectId: 'prj_test',
        systemSnapshotId: 'sys_test',
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
        state: 'manual-evidence-required',
        checks: [],
        manual: []
      }
    },
    controlIntelligence: {
      systemSnapshot: { id: 'sys_test' },
      items: [{
        controlId: 'ARL-KB-006',
        currentStage: 'test',
        chainStatus: 'test_inconclusive',
        nextAction: 'Continue.',
        deploymentImpact: 'hold',
        testMode: 'manual',
        automationStatus: 'unsupported',
        authoritativeDetail: {
          evidence: [{
            sourceType: 'active_test_plan_authorisation',
            sourceReference: 'roe:example',
            verificationState: 'verified',
            retentionStatus: 'active'
          }]
        }
      }]
    },
    readiness: {
      available: true,
      decision: 'hold',
      systemSnapshotId: 'sys_test',
      summary: {
        profileControls: 108,
        applicableControls: 105,
        controlsMissingEvidence: 99
      }
    },
    evidenceWorkQueue: {
      available: true,
      items: [{
        controlId: 'ARL-KB-006',
        classification: 'active_test_required',
        classificationReason: 'Observed execution evidence is required.',
        activeTestRequirements: ['runtime observation'],
        method: 'Use the approved local test method.'
      }],
      humanReviewBatches: []
    }
  });

  assert.equal(
    state.stage,
    'authorised_active_test_execution_required'
  );
  assert.equal(
    state.nextAllowedAction.name,
    'perform_authorised_control_test'
  );
  assert.equal(
    state.nextAllowedAction.authorisationReference,
    'roe:example'
  );
  assert.equal(state.deploymentDecisionWritten, false);
});
