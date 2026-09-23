import {
  runArlAgent as runBaseArlAgent
} from './arl-conversation-agent.mjs';

import {
  CONVERSATION_RESPONSE_SCHEMA,
  buildConversationResponse,
  detectConversationCommand,
  renderConversationAnswer
} from './conversational-workflow.mjs';

import {
  attachPublicAssessmentContract
} from './conversation-response-contract.mjs';

import {
  applyMappedControlAuthorityGuard
} from './mapped-control-authority-guard.mjs';

import {
  detectControlApplicabilityCommand,
  recordControlApplicabilityConfirmation
} from './control-applicability-handoff.mjs';

import {
  detectRemediationApplicabilityCommand,
  recordRemediationApplicabilityConfirmation
} from './remediation-applicability-handoff.mjs';

export const CONVERSATION_ORCHESTRATOR_SCHEMA =
  'arl.agent.conversation-orchestrator.v1';

function blockedApplicabilityResponse(handoff) {
  const human =
    handoff?.reason ===
      'persisted_remediation_snapshot_lineage_ambiguous' ||
    handoff?.reason ===
      'remediation_applicability_review_conflict';

  const message =
    handoff?.reason === 'remediation_worktree_dirty'
      ? 'ARL cannot record the fresh applicability review while the repository has uncommitted changes. Commit or discard the changes first.'
      : handoff?.reason ===
          'remediation_snapshot_target_binding_mismatch'
        ? 'The repository revision no longer matches the changed authoritative snapshot. ARL will not record applicability against stale target context.'
        : handoff?.reason ===
            'persisted_remediation_snapshot_lineage_ambiguous'
          ? 'More than one unresolved finding lineage points into this remediation snapshot. ARL will not guess which control the applicability confirmation belongs to.'
          : handoff?.reason ===
              'remediation_applicability_review_conflict'
            ? 'A conflicting applicability review already exists for this remediation snapshot. Accountable human review is required before the assessment can continue.'
            : 'ARL cannot bind this applicability confirmation to the current authoritative remediation snapshot. No security state was changed.';

  return {
    type: 'conversation_response',
    schema: CONVERSATION_RESPONSE_SCHEMA,
    command: 'remediation_applicability_confirm',
    stage:
      human
        ? 'remediation_applicability_conflict'
        : 'control_applicability_required',
    status:
      human
        ? 'human_action_required'
        : 'user_action_required',
    message,
    nextStep: {
      actor: human ? 'human' : 'user',
      label:
        human
          ? 'review the remediation applicability lineage'
          : 'restore the authoritative remediation snapshot context',
      requiresUserInput: true
    },
    publicSummary: null,
    needsUserAction: true,
    canAutoAdvance: false,
    acknowledgementOnly: false,
    securityStateChanged: false,
    deploymentDecisionMade: false,
    humanReviewRequired: true
  };
}

function successfulApplicabilityResponse({
  baseResponse,
  handoff,
  workflowState
}) {
  const exactRetest =
    workflowState?.stage === 'exact_retest_required';

  return {
    ...baseResponse,
    type: 'conversation_response',
    schema: CONVERSATION_RESPONSE_SCHEMA,
    command: 'remediation_applicability_confirm',
    stage:
      workflowState?.stage || baseResponse?.stage || 'unavailable',
    status:
      exactRetest
        ? 'user_action_required'
        : baseResponse?.status || 'user_action_required',
    message:
      exactRetest
        ? 'The fresh guided applicability review is now recorded for the changed snapshot. The finding remains open. The next authoritative step is the exact retest of the original failure.'
        : handoff.status === 'already_recorded'
          ? 'The fresh applicability review is already recorded. The authoritative workflow has been reloaded without changing security state.'
          : 'The fresh guided applicability review is now recorded. The authoritative workflow has been reloaded for the next evidence step.',
    nextStep:
      exactRetest
        ? {
            actor: 'user',
            label:
              'authorise the exact retest of the original failure',
            requiresUserInput: true
          }
        : baseResponse?.nextStep || null,
    needsUserAction:
      exactRetest
        ? true
        : baseResponse?.needsUserAction !== false,
    canAutoAdvance:
      exactRetest
        ? false
        : baseResponse?.canAutoAdvance === true,
    acknowledgementOnly: false,
    securityStateChanged:
      handoff.securityStateChanged === true,
    deploymentDecisionMade: false,
    humanReviewRequired: true
  };
}

function blockedBaselineApplicabilityResponse(handoff) {
  return {
    type: 'conversation_response',
    schema: CONVERSATION_RESPONSE_SCHEMA,
    command: 'control_applicability_confirm',
    stage: 'control_applicability_required',
    status: 'user_action_required',
    message:
      'ARL cannot bind that applicability confirmation to one current Evidence Plan control and authoritative snapshot. No applicability decision or deployment decision was inferred.',
    nextStep: {
      actor: 'user',
      label:
        'review the current guided applicability question',
      requiresUserInput: true
    },
    publicSummary: null,
    needsUserAction: true,
    canAutoAdvance: false,
    acknowledgementOnly: false,
    securityStateChanged: false,
    deploymentDecisionMade: false,
    humanReviewRequired: true
  };
}

function successfulBaselineApplicabilityResponse({
  baseResponse,
  handoff,
  workflowState
}) {
  const bounded =
    workflowState?.stage === 'bounded_test_required';

  return {
    ...baseResponse,
    type: 'conversation_response',
    schema: CONVERSATION_RESPONSE_SCHEMA,
    command: 'control_applicability_confirm',
    stage:
      workflowState?.stage || baseResponse?.stage || 'unavailable',
    status:
      bounded
        ? 'user_action_required'
        : baseResponse?.status || 'user_action_required',
    message:
      bounded
        ? 'The guided applicability confirmation is now recorded through Control Intelligence. The next authoritative step is the authorised bounded test required by the Evidence Plan.'
        : handoff.status === 'already_recorded'
          ? 'The guided applicability confirmation is already recorded. The authoritative workflow has been reloaded without changing security state.'
          : 'The guided applicability confirmation is now recorded through Control Intelligence. The authoritative workflow has been reloaded for the next evidence step.',
    nextStep:
      bounded
        ? {
            actor: 'user',
            label: 'authorise the bounded test',
            requiresUserInput: true
          }
        : baseResponse?.nextStep || null,
    needsUserAction:
      bounded
        ? true
        : baseResponse?.needsUserAction !== false,
    canAutoAdvance:
      bounded
        ? false
        : baseResponse?.canAutoAdvance === true,
    acknowledgementOnly: false,
    securityStateChanged:
      handoff.securityStateChanged === true,
    deploymentDecisionMade: false,
    humanReviewRequired: true
  };
}

function rebuildConversationForCommand(
  result,
  command
) {
  const workflowState =
    result?.canonicalData?.workflowState || null;

  if (!workflowState) {
    return result;
  }

  const workflowExecution =
    result?.canonicalData?.workflowExecution || null;
  const baseResponse =
    buildConversationResponse({
      command,
      workflowState
    });
  const conversationResponse =
    attachPublicAssessmentContract({
      workflowState,
      conversationResponse: baseResponse,
      workflowExecution
    });

  return {
    ...result,
    intent: {
      type: 'assessment_conversation',
      command
    },
    canonicalData: {
      ...result.canonicalData,
      workflowState,
      workflowExecution,
      conversationResponse
    },
    answer:
      renderConversationAnswer(conversationResponse)
  };
}

async function applyExactMappedControlGuard(
  result,
  options
) {
  const workflowState =
    result?.canonicalData?.workflowState || null;

  if (!workflowState) {
    return result;
  }

  const guardedState =
    await applyMappedControlAuthorityGuard({
      workflowState,
      projectId: options.projectId || null,
      userId: options.userId || null
    });

  const command =
    result?.intent?.command || 'status';
  const workflowExecution =
    result?.canonicalData?.workflowExecution
      ? {
          ...result.canonicalData.workflowExecution,
          workflowState: guardedState
        }
      : null;
  const existingResponse =
    result?.canonicalData?.conversationResponse || null;
  const customSnapshotCommand =
    command === 'snapshot' ||
    command === 'snapshot_confirm_unchanged';
  const baseResponse =
    customSnapshotCommand && existingResponse
      ? {
          ...existingResponse,
          stage: guardedState.stage,
          deploymentDecisionMade: false,
          humanReviewRequired: true
        }
      : buildConversationResponse({
          command,
          workflowState: guardedState
        });
  const conversationResponse =
    attachPublicAssessmentContract({
      workflowState: guardedState,
      conversationResponse: baseResponse,
      workflowExecution
    });

  return {
    ...result,
    canonicalData: {
      ...result.canonicalData,
      workflowState: guardedState,
      workflowExecution,
      conversationResponse
    },
    answer:
      renderConversationAnswer(conversationResponse)
  };
}

function explainPersistedExactRetest(result) {
  if (
    result?.intent?.command !== 'retest' ||
    result?.canonicalData?.workflowState?.stage !==
      'exact_retest_completion_ready'
  ) {
    return result;
  }

  const baseResponse =
    result.canonicalData.conversationResponse || {};
  const conversationResponse = {
    ...baseResponse,
    command: 'retest',
    stage: 'exact_retest_completion_ready',
    status: 'arl_ready',
    message:
      'ARL found one persisted exact retest that matches the original failed case, Rules of Engagement, target and request fingerprint. No finding is closed yet. Continue the assessment so ARL can verify and record the retest through the authoritative Phase 2 workflow.',
    nextStep: {
      actor: 'arl',
      label:
        'verify and record the persisted exact retest',
      requiresUserInput: false
    },
    needsUserAction: false,
    canAutoAdvance: true,
    acknowledgementOnly: false,
    securityStateChanged: false,
    deploymentDecisionMade: false,
    humanReviewRequired: true
  };

  return {
    ...result,
    canonicalData: {
      ...result.canonicalData,
      conversationResponse
    },
    answer:
      renderConversationAnswer(conversationResponse)
  };
}

async function preflightAutomaticCommand({
  repositoryPath,
  userRequest,
  options
}) {
  const command =
    detectConversationCommand(userRequest);

  if (
    command !== 'assess' &&
    command !== 'continue'
  ) {
    return null;
  }

  const statusBase =
    await runBaseArlAgent(
      repositoryPath,
      'Where are we?',
      options
    );
  const guarded =
    await applyExactMappedControlGuard(
      statusBase,
      options
    );
  const state =
    guarded?.canonicalData?.workflowState || null;
  const action = state?.nextAllowedAction || null;

  if (
    !state ||
    !action ||
    action.actor !== 'arl' ||
    action.requiresUserInput === true
  ) {
    return rebuildConversationForCommand(
      guarded,
      command
    );
  }

  return null;
}

export async function runArlAgent(
  repositoryPath,
  userRequest,
  options = {}
) {
  const remediationApplicabilityCommand =
    detectRemediationApplicabilityCommand(userRequest);
  const baselineApplicabilityCommand =
    remediationApplicabilityCommand
      ? null
      : detectControlApplicabilityCommand(userRequest);

  if (
    !remediationApplicabilityCommand &&
    !baselineApplicabilityCommand
  ) {
    const preflight =
      await preflightAutomaticCommand({
        repositoryPath,
        userRequest,
        options
      });

    if (preflight) {
      return explainPersistedExactRetest(preflight);
    }

    const base = await runBaseArlAgent(
      repositoryPath,
      userRequest,
      options
    );
    const guarded =
      await applyExactMappedControlGuard(
        base,
        options
      );

    return explainPersistedExactRetest(guarded);
  }

  if (baselineApplicabilityCommand) {
    const currentBase =
      await runBaseArlAgent(
        repositoryPath,
        'Where are we?',
        options
      );
    const current =
      await applyExactMappedControlGuard(
        currentBase,
        options
      );
    const handoff =
      await recordControlApplicabilityConfirmation({
        workflowState:
          current?.canonicalData?.workflowState || null,
        projectId: options.projectId || null,
        userId: options.userId || null
      });

    if (handoff.available !== true) {
      const conversationResponse =
        blockedBaselineApplicabilityResponse(handoff);

      return {
        intent: {
          type: 'assessment_conversation',
          command: baselineApplicabilityCommand
        },
        canonicalData: {
          type: 'conversation_workflow',
          schema: CONVERSATION_ORCHESTRATOR_SCHEMA,
          workflowState:
            current?.canonicalData?.workflowState || null,
          workflowExecution:
            handoff.execution || null,
          controlApplicabilityHandoff: handoff,
          conversationResponse
        },
        answer:
          renderConversationAnswer(conversationResponse)
      };
    }

    const reloadedBase =
      await runBaseArlAgent(
        repositoryPath,
        'Where are we?',
        options
      );
    const reloaded =
      await applyExactMappedControlGuard(
        reloadedBase,
        options
      );
    const workflowState =
      reloaded?.canonicalData?.workflowState || null;
    const conversationResponse =
      successfulBaselineApplicabilityResponse({
        baseResponse:
          reloaded?.canonicalData?.conversationResponse || null,
        handoff,
        workflowState
      });

    return {
      ...reloaded,
      intent: {
        type: 'assessment_conversation',
        command: baselineApplicabilityCommand
      },
      canonicalData: {
        ...reloaded.canonicalData,
        type: 'conversation_workflow',
        schema: CONVERSATION_ORCHESTRATOR_SCHEMA,
        controlApplicabilityHandoff: handoff,
        conversationResponse
      },
      answer:
        renderConversationAnswer(conversationResponse)
    };
  }

  const handoff =
    await recordRemediationApplicabilityConfirmation({
      repositoryPath,
      projectId: options.projectId || null,
      userId: options.userId || null,
      assessmentId: options.assessmentId || null
    });

  if (handoff.available !== true) {
    const conversationResponse =
      blockedApplicabilityResponse(handoff);

    return {
      intent: {
        type: 'assessment_conversation',
        command: remediationApplicabilityCommand
      },
      canonicalData: {
        type: 'conversation_workflow',
        schema: CONVERSATION_ORCHESTRATOR_SCHEMA,
        workflowState: null,
        workflowExecution:
          handoff.execution || null,
        remediationApplicabilityHandoff: handoff,
        conversationResponse
      },
      answer:
        renderConversationAnswer(conversationResponse)
    };
  }

  const reloadedBase =
    await runBaseArlAgent(
      repositoryPath,
      'Where are we?',
      options
    );
  const reloaded =
    await applyExactMappedControlGuard(
      reloadedBase,
      options
    );

  const workflowState =
    reloaded?.canonicalData?.workflowState || null;
  const conversationResponse =
    successfulApplicabilityResponse({
      baseResponse:
        reloaded?.canonicalData?.conversationResponse || null,
      handoff,
      workflowState
    });

  return {
    ...reloaded,
    intent: {
      type: 'assessment_conversation',
      command: remediationApplicabilityCommand
    },
    canonicalData: {
      ...reloaded.canonicalData,
      type: 'conversation_workflow',
      schema: CONVERSATION_ORCHESTRATOR_SCHEMA,
      remediationApplicabilityHandoff: handoff,
      conversationResponse
    },
    answer:
      renderConversationAnswer(conversationResponse)
  };
}
