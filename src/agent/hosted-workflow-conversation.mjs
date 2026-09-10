import {
  getControlIntelligence
} from '../control-intelligence.js';

import {
  deriveAuthoritativeWorkflowState
} from './authoritative-workflow-state.mjs';
import {
  applyPersistedGateState
} from './persisted-gate-state.mjs';
import {
  applyMappedControlAuthorityGuard
} from './mapped-control-authority-guard.mjs';
import {
  buildConversationResponse
} from './conversational-workflow.mjs';
import {
  attachPublicAssessmentContract
} from './conversation-response-contract.mjs';
import {
  getDeploymentReadiness
} from './tools/get-deployment-readiness.mjs';

export const HOSTED_WORKFLOW_CONVERSATION_SCHEMA =
  'arl.agent.hosted-workflow-conversation.v1';
export const HOSTED_APPLICABILITY_REVIEW_SCHEMA =
  'arl.agent.hosted-applicability-review.v1';

function hostedConversationError(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}

function applicabilityCandidates(workflowState) {
  const relevant =
    workflowState?.authoritativeArtifacts
      ?.controlIntelligence?.relevantControls;
  const mapped =
    workflowState?.authoritativeArtifacts
      ?.evidencePlan?.mappedControls;
  const mappedIds = new Set(
    (Array.isArray(mapped) ? mapped : [])
      .map((item) => item?.controlId)
      .filter(Boolean)
  );

  return (Array.isArray(relevant) ? relevant : [])
    .filter(
      (item) =>
        item?.controlId &&
        item.currentStage === 'applicability' &&
        mappedIds.has(item.controlId)
    )
    .map((item) => ({
      controlId: item.controlId,
      currentStage: item.currentStage,
      nextAction: item.nextAction || null
    }))
    .sort((left, right) =>
      left.controlId.localeCompare(right.controlId)
    );
}

function applicabilityReview(workflowState) {
  if (workflowState?.stage === 'control_applicability_required') {
    const controlId = workflowState?.scopedControl?.controlId || null;
    if (!controlId) return null;
    return {
      schema: HOSTED_APPLICABILITY_REVIEW_SCHEMA,
      required: true,
      requiresControlSelection: false,
      candidates: [
        {
          controlId,
          currentStage: 'applicability',
          nextAction:
            workflowState?.scopedControl?.nextAction || null
        }
      ],
      applicabilityDecisionMade: false
    };
  }

  const ambiguity =
    workflowState?.mappedControlAuthorityGuard?.ambiguity === true &&
    workflowState?.mappedControlAuthorityGuard?.reason ===
      'mapped_control_applicability_ambiguous';
  if (
    workflowState?.stage !== 'persisted_lineage_resolution_required' ||
    !ambiguity
  ) {
    return null;
  }

  const candidates = applicabilityCandidates(workflowState);
  if (!candidates.length) return null;

  return {
    schema: HOSTED_APPLICABILITY_REVIEW_SCHEMA,
    required: true,
    requiresControlSelection: candidates.length > 1,
    candidates,
    applicabilityDecisionMade: false
  };
}

export async function buildHostedPreparationConversation({
  operatorContextInternal,
  preparation,
  command = 'assess'
} = {}) {
  const projectId = String(
    operatorContextInternal?.projectId || ''
  ).trim();
  const userId = String(
    operatorContextInternal?.userId || ''
  ).trim();
  const assessmentId = String(
    operatorContextInternal?.assessmentId || ''
  ).trim();

  if (!projectId || !userId || !assessmentId) {
    throw hostedConversationError(
      'HOSTED_OPERATOR_CONTEXT_REQUIRED',
      'Server-resolved ARL operator context is required before hosted conversation state can be projected.'
    );
  }

  let controlIntelligence = null;
  if (preparation?.assessmentContext?.available === true) {
    controlIntelligence = await getControlIntelligence({
      projectId,
      userId
    });
  }

  const readiness = await getDeploymentReadiness({
    projectId,
    userId
  });

  let workflowState = deriveAuthoritativeWorkflowState({
    projectId,
    userId,
    assessmentId,
    preparation,
    controlIntelligence,
    readiness
  });

  workflowState = await applyPersistedGateState({
    workflowState,
    projectId,
    userId,
    assessmentId
  });

  workflowState = await applyMappedControlAuthorityGuard({
    workflowState,
    projectId,
    userId
  });

  /*
   * The base workflow may carry a stale paginated bounded-test scope.
   * The exact mapped-control guard above can replace that fallback with the
   * authoritative Control Intelligence controlId/caseId. Re-evaluate persisted
   * gates against that exact scope so a just-persisted bounded run can advance
   * to authoritative evidence recording instead of requesting the same test
   * again.
   */
  workflowState = await applyPersistedGateState({
    workflowState,
    projectId,
    userId,
    assessmentId
  });

  const baseResponse = buildConversationResponse({
    command,
    workflowState
  });
  const projectedResponse = attachPublicAssessmentContract({
    workflowState,
    conversationResponse: baseResponse,
    workflowExecution: null
  });
  const review = applicabilityReview(workflowState);
  const conversationResponse = review
    ? {
        ...projectedResponse,
        applicabilityReview: review
      }
    : projectedResponse;

  return {
    schema: HOSTED_WORKFLOW_CONVERSATION_SCHEMA,
    conversationResponse,
    internal: {
      workflowState
    },
    securityStateChanged: false,
    deploymentDecisionWritten: false,
    humanReviewRequired: true
  };
}
