import test from 'node:test';
import assert from 'node:assert/strict';

import {
  executeGatedWorkflow
} from '../src/agent/gated-workflow-executor.mjs';

function state(index, total = 101) {
  if (index >= total) {
    return {
      schema: 'arl.agent.workflow-state.v1',
      available: true,
      stage: 'manual_evidence_required',
      deploymentDecisionWritten: false,
      humanReviewRequired: true,
      readiness: { decision: 'hold' },
      scopedControl: {
        controlId: 'ARL-KB-108',
        currentStage: 'test'
      },
      nextAllowedAction: {
        name: 'provide_required_manual_evidence',
        actor: 'user',
        requiresUserInput: true,
        controlId: 'ARL-KB-108'
      }
    };
  }

  return {
    schema: 'arl.agent.workflow-state.v1',
    available: true,
    stage: 'control_evidence_collection_required',
    deploymentDecisionWritten: false,
    humanReviewRequired: true,
    readiness: { decision: 'hold' },
    scopedControl: {
      controlId:
        `ARL-KB-${String(index + 1).padStart(3, '0')}`,
      currentStage: 'test'
    },
    nextAllowedAction: {
      name: 'collect_authoritative_control_evidence',
      actor: 'arl',
      requiresUserInput: false,
      controlId:
        `ARL-KB-${String(index + 1).padStart(3, '0')}`
    }
  };
}

test('default gated workflow can drain a full-profile automatic queue before the real human gate', async () => {
  let index = 0;

  const result =
    await executeGatedWorkflow({
      initialState: state(index),
      loadState: async () => {
        index += 1;
        return state(index);
      },
      executeAction: async () => ({
        executed: true,
        securityStateChanged: true
      })
    });

  assert.equal(result.status, 'gate_reached');
  assert.equal(result.reason, 'user_action_required');
  assert.equal(result.executedActionCount, 101);
  assert.equal(
    result.workflowState.stage,
    'manual_evidence_required'
  );
});

test('gated workflow still rejects unreasonable automatic step budgets', async () => {
  await assert.rejects(
    executeGatedWorkflow({
      initialState: state(0),
      loadState: async () => state(1),
      executeAction: async () => ({ executed: true }),
      maxSteps: 257
    }),
    /between 1 and 256/
  );
});
