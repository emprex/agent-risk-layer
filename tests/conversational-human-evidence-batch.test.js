import test from 'node:test';
import assert from 'node:assert/strict';

import {
  buildConversationResponse
} from '../src/agent/conversational-workflow.mjs';

test('manual evidence conversation surfaces consolidated batch identity and safety semantics', () => {
  const response =
    buildConversationResponse({
      command: 'continue',
      workflowState: {
        schema: 'arl.agent.workflow-state.v1',
        available: true,
        stage: 'manual_evidence_required',
        nextAllowedAction: {
          name: 'provide_required_manual_evidence',
          actor: 'user',
          requiresUserInput: true
        },
        humanEvidenceBatch: {
          batchId:
            'human_evidence_batch_abcdef123456',
          controlIds: [
            'ARL-KB-010',
            'ARL-KB-011'
          ],
          requirements: [
            'Accountable owner declaration',
            'Documented review record'
          ]
        },
        deploymentDecisionWritten: false,
        humanReviewRequired: true
      }
    });

  assert.equal(response.status, 'user_action_required');
  assert.match(
    response.message,
    /human_evidence_batch_abcdef123456/
  );
  assert.match(
    response.message,
    /covering 2 controls/
  );
  assert.match(
    response.message,
    /2 canonical evidence requirements/
  );
  assert.match(
    response.message,
    /will not accept a bare PASS\/FAIL claim/
  );
  assert.equal(response.deploymentDecisionMade, false);
  assert.equal(response.humanReviewRequired, true);
});
