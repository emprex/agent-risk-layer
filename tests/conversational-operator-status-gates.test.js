import test from 'node:test';
import assert from 'node:assert/strict';

import {
  buildConversationResponse
} from '../src/agent/conversational-workflow.mjs';

const GATES = [
  {
    stage: 'control_evidence_collection_required',
    action: 'collect_authoritative_control_evidence',
    actor: 'arl',
    expected: /deterministic frozen-source evidence collection/
  },
  {
    stage: 'active_test_plan_required',
    action: 'define_and_authorise_control_test',
    actor: 'human',
    expected: /human authorisation/
  },
  {
    stage: 'authorised_active_test_execution_required',
    action: 'perform_authorised_control_test',
    actor: 'user',
    expected: /authorised active test/
  },
  {
    stage: 'active_test_evidence_review_required',
    action: 'review_inconclusive_control_evidence',
    actor: 'human',
    expected: /inconclusive active-test evidence/
  },
  {
    stage: 'control_test_required',
    action: 'run_authoritative_control_test',
    actor: 'arl',
    expected: /authoritative control test/
  }
];

function state(stage, action, actor) {
  return {
    schema: 'arl.agent.workflow-state.v1',
    available: true,
    stage,
    nextAllowedAction: {
      name: action,
      actor,
      controlId: 'ARL-KB-053',
      requiresUserInput: actor !== 'arl'
    },
    deploymentDecisionWritten: false,
    humanReviewRequired: true
  };
}

for (const gate of GATES) {
  test(`operator status describes the ${gate.stage} gate without generic fallback`, () => {
    const response = buildConversationResponse({
      command: 'status',
      workflowState: state(gate.stage, gate.action, gate.actor)
    });
    assert.match(response.message, gate.expected);
    assert.match(response.message, /Control: ARL-KB-053/);
    assert.doesNotMatch(response.message, /the authoritative workflow requires another step/);
    assert.doesNotMatch(response.message, /continue with the next authoritative ARL step/);
    assert.equal(response.status,
      gate.actor === 'arl' ? 'arl_ready' :
      gate.actor === 'human' ? 'human_action_required' : 'user_action_required');
    assert.equal(response.securityStateChanged, false);
    assert.equal(response.deploymentDecisionMade, false);
    assert.equal(response.humanReviewRequired, true);
  });
}

test('unknown stage and action retain their safe identifiers for diagnosis', () => {
  const response = buildConversationResponse({
    command: 'status',
    workflowState: state('future_review_required', 'future_review_action', 'human')
  });
  assert.match(response.message, /unrecognised workflow stage \(future_review_required\)/);
  assert.match(response.message, /unrecognised authoritative action \(future_review_action\)/);
  assert.equal(response.status, 'human_action_required');
  assert.equal(response.canAutoAdvance, false);
  assert.equal(response.deploymentDecisionMade, false);
});
