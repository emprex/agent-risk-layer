import {
  getAuthoritativeWorkflowState
} from './authoritative-workflow-state.mjs';

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
  applyPersistedGateState
} from './persisted-gate-state.mjs';

import {
  captureGitRemediationHandoff
} from './git-remediation-handoff.mjs';

import {
  captureChangedSystemSnapshotHandoff,
  detectChangedSnapshotCommand
} from './changed-system-snapshot-handoff.mjs';

import {
  executeGatedWorkflow
} from './gated-workflow-executor.mjs';

import {
  executeAuthoritativeArlAction
} from './authoritative-auto-actions.mjs';

import {
  runToolAgent
} from './arl-tool-agent.mjs';

export const CONVERSATION_WORKFLOW_SCHEMA =
  'arl.agent.conversation-workflow.v1';

const AUTO_CONTINUE_COMMANDS = new Set([
  'assess',
  'continue'
]);

function remediationResponsePatch(remediationHandoff) {
  if (!remediationHandoff) {
    return null;
  }

  if (
    remediationHandoff.reason ===
    'remediation_worktree_dirty'
  ) {
    return {
      status: 'user_action_required',
      message:
        'I checked the repository, but the remediation is not a clean committed revision yet. I will not use uncommitted changes as implementation evidence. Commit the remediation and leave the worktree clean.',
      nextStep: {
        actor: 'user',
        label:
          'commit the remediation and leave the Git worktree clean',
        requiresUserInput: true
      },
      needsUserAction: true,
      canAutoAdvance: false
    };
  }

  if (
    remediationHandoff.reason ===
    'repository_revision_unchanged'
  ) {
    return {
      status: 'user_action_required',
      message:
        'I checked the repository. HEAD still matches the revision bound to the failed snapshot, so “I fixed it” is not proof. Commit the remediation change first.',
      nextStep: {
        actor: 'user',
        label: 'commit the remediation change',
        requiresUserInput: true
      },
      needsUserAction: true,
      canAutoAdvance: false
    };
  }

  if (
    remediationHandoff.reason ===
    'active_authoritative_remediation_ambiguous'
  ) {
    return {
      status: 'human_action_required',
      message:
        'More than one authoritative finding is currently in remediation on this snapshot. ARL will not guess which finding this Git change fixes. The remediation lineage must be selected explicitly before evidence is recorded.',
      nextStep: {
        actor: 'human',
        label:
          'review which active finding the remediation belongs to',
        requiresUserInput: true
      },
      needsUserAction: true,
      canAutoAdvance: false
    };
  }

  if (
    remediationHandoff.status ===
    'implementation_recorded'
  ) {
    return {
      status: 'user_action_required',
      message:
        'ARL verified a clean changed Git revision and recorded it as remediation implementation evidence. The finding is still open. A changed authoritative system snapshot is required before any exact retest.',
      nextStep: {
        actor: 'user',
        label: 'capture a changed system snapshot',
        requiresUserInput: true
      },
      needsUserAction: true,
      canAutoAdvance: false
    };
  }

  if (
    remediationHandoff.status ===
    'already_recorded'
  ) {
    return {
      status: 'user_action_required',
      message:
        'The remediation implementation evidence is already recorded. The finding remains open until a changed system snapshot exists and the exact retest is verified.',
      nextStep: {
        actor: 'user',
        label: 'capture a changed system snapshot',
        requiresUserInput: true
      },
      needsUserAction: true,
      canAutoAdvance: false
    };
  }

  if (
    remediationHandoff.reason ===
    'active_authoritative_remediation_not_found'
  ) {
    return {
      status: 'user_action_required',
      message:
        'ARL cannot bind this Git change to an active authoritative remediation on the current snapshot. I will not record implementation evidence without the finding lineage.',
      nextStep: {
        actor: 'user',
        label: 'review the current authoritative findings',
        requiresUserInput: true
      },
      needsUserAction: true,
      canAutoAdvance: false
    };
  }

  return null;
}

function snapshotNextStep(workflowState) {
  if (
    workflowState?.stage ===
    'control_applicability_required'
  ) {
    return {
      actor: 'user',
      label:
        'review control applicability for the changed snapshot',
      requiresUserInput: true
    };
  }

  const action = workflowState?.nextAllowedAction;
  const actor =
    ['arl', 'user', 'human'].includes(action?.actor)
      ? action.actor
      : 'user';

  return {
    actor,
    label:
      actor === 'human'
        ? 'complete the required accountable human review'
        : actor === 'arl'
          ? 'continue with the next authoritative ARL step'
          : 'complete the next authoritative assessment step',
    requiresUserInput: actor !== 'arl'
  };
}

function snapshotConversationResponse({
  command,
  handoff,
  workflowState
}) {
  const base = {
    type: 'conversation_response',
    schema: CONVERSATION_RESPONSE_SCHEMA,
    command,
    stage:
      workflowState?.stage || 'unavailable',
    publicSummary: null,
    acknowledgementOnly: false,
    deploymentDecisionMade: false,
    humanReviewRequired: true
  };

  if (
    handoff?.reason ===
    'architecture_confirmation_required'
  ) {
    return {
      ...base,
      status: 'user_action_required',
      message:
        'ARL has implementation evidence for the changed Git revision, but I will not copy the previous declared architecture into a new authoritative snapshot without your confirmation. If the remediation did not change the declared architecture, say: “Architecture unchanged — capture changed snapshot.” If it did change, update the architecture context instead.',
      nextStep: {
        actor: 'user',
        label:
          'confirm the architecture is unchanged or update the architecture context',
        requiresUserInput: true
      },
      needsUserAction: true,
      canAutoAdvance: false,
      securityStateChanged: false
    };
  }

  if (
    handoff?.reason ===
    'current_revision_implementation_evidence_required'
  ) {
    return {
      ...base,
      status: 'user_action_required',
      message:
        'The current Git revision is not yet bound to remediation implementation evidence, so ARL will not create a changed authoritative snapshot from it. Commit the remediation and use “I fixed it” first so ARL can verify and bind the change.',
      nextStep: {
        actor: 'user',
        label:
          'record the committed remediation as implementation evidence',
        requiresUserInput: true
      },
      needsUserAction: true,
      canAutoAdvance: false,
      securityStateChanged: false
    };
  }

  if (handoff?.reason === 'remediation_worktree_dirty') {
    return {
      ...base,
      status: 'user_action_required',
      message:
        'ARL cannot capture a changed authoritative snapshot from an uncommitted worktree. Commit the remediation and leave the repository clean first.',
      nextStep: {
        actor: 'user',
        label:
          'commit the remediation and leave the Git worktree clean',
        requiresUserInput: true
      },
      needsUserAction: true,
      canAutoAdvance: false,
      securityStateChanged: false
    };
  }

  if (handoff?.reason === 'repository_revision_unchanged') {
    return {
      ...base,
      status: 'user_action_required',
      message:
        'The repository still matches the revision bound to the vulnerable snapshot. ARL will not create a changed snapshot until there is a committed change.',
      nextStep: {
        actor: 'user',
        label: 'commit the remediation change',
        requiresUserInput: true
      },
      needsUserAction: true,
      canAutoAdvance: false,
      securityStateChanged: false
    };
  }

  if (
    handoff?.reason ===
    'active_authoritative_remediation_ambiguous'
  ) {
    return {
      ...base,
      status: 'human_action_required',
      message:
        'More than one active remediation is bound to the current vulnerable snapshot. ARL will not choose a remediation lineage automatically before creating the changed snapshot.',
      nextStep: {
        actor: 'human',
        label: 'review the active remediation lineage',
        requiresUserInput: true
      },
      needsUserAction: true,
      canAutoAdvance: false,
      securityStateChanged: false
    };
  }

  if (handoff?.status === 'snapshot_recorded') {
    const nextStep = snapshotNextStep(workflowState);
    const applicabilityReview =
      workflowState?.stage ===
      'control_applicability_required';

    return {
      ...base,
      status:
        nextStep.actor === 'human'
          ? 'human_action_required'
          : nextStep.actor === 'arl'
            ? 'arl_ready'
            : 'user_action_required',
      message:
        applicabilityReview
          ? 'The changed system snapshot is now bound to the new committed revision. ARL did not copy the previous control-applicability decision. The changed snapshot requires a fresh guided applicability review before testing can continue.'
          : 'The changed system snapshot is now bound to the new committed revision. ARL did not infer deployment readiness or close any finding. The authoritative workflow has been reloaded for the next step.',
      nextStep,
      needsUserAction:
        nextStep.requiresUserInput,
      canAutoAdvance:
        nextStep.actor === 'arl' &&
        !nextStep.requiresUserInput,
      securityStateChanged:
        handoff.securityStateChanged === true
    };
  }

  return {
    ...base,
    status: 'blocked',
    message:
      'ARL cannot safely capture the changed system snapshot from the current authoritative state. No snapshot or deployment decision is inferred.',
    nextStep: null,
    needsUserAction: true,
    canAutoAdvance: false,
    securityStateChanged: false
  };
}

function conversationResult({
  command,
  workflowState,
  workflowExecution = null,
  remediationHandoff = null,
  changedSystemSnapshotHandoff = null,
  conversationResponseOverride = null
}) {
  const baseConversationResponse =
    conversationResponseOverride ||
    buildConversationResponse({
      command,
      workflowState
    });

  const changed =
    workflowExecution?.securityStateChanged === true ||
    remediationHandoff?.securityStateChanged === true ||
    changedSystemSnapshotHandoff?.securityStateChanged === true;

  const remediationPatch =
    command === 'fixed' &&
    !conversationResponseOverride
      ? remediationResponsePatch(remediationHandoff)
      : null;

  const adjustedConversationResponse = {
    ...baseConversationResponse,
    ...(remediationPatch || {}),
    acknowledgementOnly:
      command === 'fixed' && !changed,
    securityStateChanged: changed
  };

  const conversationResponse =
    attachPublicAssessmentContract({
      workflowState,
      conversationResponse:
        adjustedConversationResponse,
      workflowExecution
    });

  return {
    intent: {
      type: 'assessment_conversation',
      command
    },
    canonicalData: {
      type: 'conversation_workflow',
      schema: CONVERSATION_WORKFLOW_SCHEMA,
      workflowState,
      workflowExecution,
      remediationHandoff,
      changedSystemSnapshotHandoff,
      conversationResponse
    },
    answer:
      renderConversationAnswer(
        conversationResponse
      )
  };
}

export async function runArlAgent(
  repositoryPath,
  userRequest,
  {
    projectId = null,
    userId = null,
    assessmentId = null
  } = {}
) {
  if (!repositoryPath) {
    throw new Error('repositoryPath is required');
  }

  if (!userRequest) {
    throw new Error('userRequest is required');
  }

  const changedSnapshotCommand =
    detectChangedSnapshotCommand(userRequest);

  const command =
    changedSnapshotCommand ||
    detectConversationCommand(userRequest);

  if (command) {
    const loadWorkflowState = async () => {
      const baseState =
        await getAuthoritativeWorkflowState({
          repositoryPath,
          projectId,
          userId,
          assessmentId
        });

      /*
       * P3.5 may promote an already-satisfied user gate only when persisted
       * authoritative Red Team lineage proves that the required bounded test
       * or exact retest has already occurred. The same policy layer also
       * enforces guided-customer applicability as a user gate instead of an
       * automatic ARL security decision.
       */
      return applyPersistedGateState({
        workflowState: baseState,
        projectId,
        userId,
        assessmentId
      });
    };

    /*
     * P3.6 snapshot capture is explicit. A generic capture request is read-only
     * and requests confirmation. Only the explicit architecture-unchanged form
     * may copy the previous declared architecture into a new snapshot, and only
     * after the current Git revision is clean and bound to implementation
     * evidence for the active finding.
     */
    if (
      command === 'snapshot' ||
      command === 'snapshot_confirm_unchanged'
    ) {
      const changedSystemSnapshotHandoff =
        await captureChangedSystemSnapshotHandoff({
          repositoryPath,
          projectId,
          userId,
          assessmentId,
          confirmArchitectureUnchanged:
            command === 'snapshot_confirm_unchanged'
        });

      let workflowState =
        changedSystemSnapshotHandoff.workflowState || null;

      if (
        changedSystemSnapshotHandoff.status ===
        'snapshot_recorded'
      ) {
        workflowState =
          await loadWorkflowState();
      }

      if (!workflowState) {
        workflowState =
          await loadWorkflowState();
      }

      const response =
        snapshotConversationResponse({
          command,
          handoff:
            changedSystemSnapshotHandoff,
          workflowState
        });

      return conversationResult({
        command,
        workflowState,
        workflowExecution:
          changedSystemSnapshotHandoff.execution || null,
        changedSystemSnapshotHandoff,
        conversationResponseOverride: response
      });
    }

    /*
     * "I fixed it" has a dedicated remediation handoff. The phrase is never
     * evidence. ARL first resolves the authoritative open remediation, then
     * requires a clean committed Git revision different from the revision
     * bound to the failed system snapshot. Only that observed repository change
     * may be registered as implementation evidence. The handoff stops at the
     * changed-system-snapshot gate and never closes the finding or runs a retest.
     */
    if (command === 'fixed') {
      const remediationHandoff =
        await captureGitRemediationHandoff({
          repositoryPath,
          projectId,
          userId,
          assessmentId
        });

      if (
        remediationHandoff.available === true &&
        remediationHandoff.workflowState
      ) {
        return conversationResult({
          command,
          workflowState:
            remediationHandoff.workflowState,
          workflowExecution:
            remediationHandoff.execution || null,
          remediationHandoff
        });
      }
    }

    const initialWorkflowState =
      await loadWorkflowState();

    let workflowExecution = null;
    let workflowState = initialWorkflowState;

    if (AUTO_CONTINUE_COMMANDS.has(command)) {
      workflowExecution =
        await executeGatedWorkflow({
          initialState: initialWorkflowState,
          loadState: loadWorkflowState,
          executeAction: ({ action }) =>
            executeAuthoritativeArlAction({
              action,
              repositoryPath,
              projectId,
              userId,
              assessmentId
            })
        });

      workflowState =
        workflowExecution.workflowState ||
        initialWorkflowState;
    }

    return conversationResult({
      command,
      workflowState,
      workflowExecution
    });
  }

  return runToolAgent(
    repositoryPath,
    userRequest,
    {
      projectId,
      userId,
      assessmentId
    }
  );
}
