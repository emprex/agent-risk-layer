export const CONVERSATION_RESPONSE_SCHEMA =
  'arl.agent.conversation-response.v1';

const WORKFLOW_STATE_SCHEMA =
  'arl.agent.workflow-state.v1';

const SUPPORTED_COMMANDS = Object.freeze([
  'assess',
  'continue',
  'needs',
  'findings',
  'remediation',
  'fixed',
  'retest',
  'readiness',
  'status'
]);

const STAGE_LABELS = Object.freeze({
  authoritative_identity_required:
    'assessment identity is required',
  assessment_context_required:
    'authoritative assessment context is required',
  authoritative_assessment_required:
    'an authoritative assessment must be selected or created',
  target_context_binding_required:
    'the frozen target must be bound to the authoritative context',
  assessment_context_binding_required:
    'the assessment must be bound to the active system snapshot',
  evidence_plan_required:
    'the authoritative Evidence Plan must be built',
  control_applicability_required:
    'control applicability must be resolved from authoritative project state',
  source_evidence_required:
    'frozen source evidence is required',
  bounded_test_required:
    'an authorised bounded test is required',
  control_test_required:
    'an authoritative control test is required',
  evidence_recording_required:
    'qualifying evidence must be recorded authoritatively',
  finding_creation_required:
    'the failed authoritative test requires a finding',
  remediation_required:
    'remediation implementation evidence is required',
  changed_system_snapshot_required:
    'a changed system snapshot is required',
  exact_retest_required:
    'an authorised exact retest is required',
  human_approval_required:
    'an accountable human approval is required',
  manual_evidence_required:
    'qualifying manual evidence is required',
  readiness_review:
    'Control Intelligence readiness is ready for human review'
});

const ACTION_LABELS = Object.freeze({
  provide_authoritative_assessment_identity:
    'provide the assessment identity',
  complete_authoritative_assessment_context:
    'complete the authoritative assessment context',
  select_or_create_authoritative_assessment:
    'select or create the authoritative assessment',
  bind_frozen_target_to_context:
    'bind the frozen target to the authoritative context',
  bind_assessment_to_snapshot:
    'bind the assessment to the active system snapshot',
  build_authoritative_evidence_plan:
    'build the authoritative Evidence Plan',
  resolve_control_applicability:
    'resolve control applicability from authoritative project state',
  run_frozen_source_inspection:
    'inspect the frozen source for the required evidence',
  authorise_and_run_bounded_test:
    'authorise the bounded test',
  provide_authoritative_control_test:
    'provide the required authoritative control test',
  record_authoritative_evidence:
    'record the qualifying evidence',
  create_authoritative_finding:
    'create the authoritative finding from the persisted failed test and evidence',
  provide_remediation_implementation:
    'provide remediation implementation evidence',
  capture_changed_system_snapshot:
    'capture a changed system snapshot',
  authorise_and_run_exact_retest:
    'authorise the exact retest against the changed snapshot',
  record_required_human_approval:
    'record the required accountable human approval',
  provide_required_manual_evidence:
    'provide the required manual evidence',
  review_current_arl_readiness:
    'review the current Control Intelligence readiness'
});

const COMMAND_PATTERNS = Object.freeze([
  {
    command: 'assess',
    patterns: [
      /\bassess this agent\b/,
      /\bassess this repository\b/,
      /\bstart (?:the )?assessment\b/
    ]
  },
  {
    command: 'continue',
    patterns: [
      /^continue(?: assessment)?[.!?]*$/,
      /\bcontinue (?:the )?assessment\b/,
      /\bcarry on (?:with )?(?:the )?assessment\b/,
      /\bnext assessment step\b/
    ]
  },
  {
    command: 'needs',
    patterns: [
      /\bwhat do you need from me\b/,
      /\bwhat do you need\b/,
      /\bwhat(?:'s| is) needed from me\b/
    ]
  },
  {
    command: 'findings',
    patterns: [
      /\bshow (?:me )?(?:the )?(?:current )?findings\b/,
      /\bcurrent findings\b/,
      /\bwhat are (?:the )?(?:current )?findings\b/,
      /\bwhat findings do we have\b/
    ]
  },
  {
    command: 'remediation',
    patterns: [
      /\bwhat should i fix\b/,
      /\bwhat do i need to fix\b/,
      /\bwhat needs fixing\b/,
      /\bwhat should we fix\b/
    ]
  },
  {
    command: 'fixed',
    patterns: [
      /\bi fixed it\b/,
      /\bi(?:'ve| have) fixed it\b/,
      /\bfixed it\b/,
      /\bthe fix is done\b/,
      /\bremediation is done\b/
    ]
  },
  {
    command: 'retest',
    patterns: [
      /\brun (?:the )?(?:exact )?retest\b/,
      /\breview (?:the )?(?:exact )?retest\b/,
      /\bcan (?:we|you) (?:run )?(?:the )?(?:exact )?retest\b/,
      /\bwhat about (?:the )?retest\b/,
      /^retest[.!?]*$/
    ]
  },
  {
    command: 'readiness',
    patterns: [
      /\bis (?:it|this|the agent) ready to deploy\b/,
      /\bready to deploy\b/,
      /\bdeployment readiness\b/,
      /\bcan (?:it|this|the agent) be deployed\b/
    ]
  },
  {
    command: 'status',
    patterns: [
      /\bwhere are we\b/,
      /\bassessment status\b/,
      /\bwhat(?:'s| is) the status\b/
    ]
  }
]);

function normalise(text) {
  return String(text || '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ');
}

export function detectConversationCommand(userRequest) {
  const text = normalise(userRequest);

  if (!text) {
    return null;
  }

  for (const entry of COMMAND_PATTERNS) {
    if (entry.patterns.some((pattern) => pattern.test(text))) {
      return entry.command;
    }
  }

  return null;
}

function actionLabel(action) {
  return (
    ACTION_LABELS[action?.name] ||
    'continue with the next authoritative ARL step'
  );
}

function stageLabel(stage) {
  return (
    STAGE_LABELS[stage] ||
    'the authoritative workflow requires another step'
  );
}

function relevantControls(workflowState) {
  const controls =
    workflowState?.authoritativeArtifacts
      ?.controlIntelligence?.relevantControls;

  return Array.isArray(controls)
    ? controls
    : [];
}

function buildFindingSummary(workflowState) {
  const controls = relevantControls(workflowState);
  const countStage = (stage) =>
    controls.filter(
      (item) => item?.currentStage === stage
    ).length;

  const pendingCreationCount =
    countStage('finding');
  const remediationCount =
    countStage('remediation');
  const retestCount =
    countStage('retest');

  return {
    authoritativeStateAvailable:
      workflowState?.authoritativeArtifacts
        ?.controlIntelligence?.available === true,
    pendingCreationCount,
    activeCount:
      remediationCount + retestCount,
    remediationCount,
    retestCount
  };
}

function normaliseReadinessDecision(value) {
  if (typeof value !== 'string') {
    return null;
  }

  const token = value
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g, '_');

  if (token === 'hold') {
    return 'HOLD';
  }

  if (
    token === 'do_not_deploy' ||
    token === 'donotdeploy'
  ) {
    return 'DO NOT DEPLOY';
  }

  if (token === 'proceed') {
    return 'PROCEED';
  }

  return null;
}

function buildReadinessSummary(workflowState) {
  const source =
    workflowState?.readiness ||
    workflowState?.authoritativeArtifacts?.readiness ||
    null;

  if (source?.available !== true) {
    return {
      available: false,
      decision: null,
      humanReviewRequired: true,
      finalDeploymentDecisionMade: false
    };
  }

  return {
    available: true,
    decision:
      normaliseReadinessDecision(source.decision),
    humanReviewRequired: true,
    finalDeploymentDecisionMade: false
  };
}

function publicSummaryForCommand(
  command,
  workflowState
) {
  if (
    command === 'findings' ||
    command === 'remediation'
  ) {
    return {
      findings: buildFindingSummary(workflowState)
    };
  }

  if (command === 'retest') {
    return {
      retest: {
        required:
          workflowState.stage ===
          'exact_retest_required',
        securityStateChanged: false
      }
    };
  }

  if (command === 'readiness') {
    return {
      readiness:
        buildReadinessSummary(workflowState)
    };
  }

  return null;
}

function failClosedResponse(command, workflowState) {
  return {
    type: 'conversation_response',
    schema: CONVERSATION_RESPONSE_SCHEMA,
    command,
    stage: workflowState?.stage || 'unavailable',
    status: 'blocked',
    message:
      'ARL cannot safely continue because the authoritative workflow state is unavailable or invalid.',
    nextStep: null,
    publicSummary: null,
    needsUserAction: true,
    canAutoAdvance: false,
    acknowledgementOnly: command === 'fixed',
    securityStateChanged: false,
    deploymentDecisionMade: false,
    humanReviewRequired: true
  };
}

function stateIsUsable(workflowState) {
  return Boolean(
    workflowState &&
    workflowState.schema === WORKFLOW_STATE_SCHEMA &&
    workflowState.available === true &&
    typeof workflowState.stage === 'string' &&
    workflowState.nextAllowedAction &&
    ['arl', 'user', 'human'].includes(
      workflowState.nextAllowedAction.actor
    ) &&
    workflowState.deploymentDecisionWritten === false &&
    workflowState.humanReviewRequired === true
  );
}

function responseStatus(actor) {
  if (actor === 'arl') {
    return 'arl_ready';
  }

  if (actor === 'human') {
    return 'human_action_required';
  }

  return 'user_action_required';
}

function defaultMessage({ command, stage, actor, label }) {
  const current = stageLabel(stage);

  if (command === 'needs') {
    if (actor === 'arl') {
      return `Nothing is required from you right now. ARL can ${label}.`;
    }

    if (actor === 'human') {
      return `The workflow is at a human accountability gate. The next step is to ${label}.`;
    }

    return `I need you to ${label}.`;
  }

  if (command === 'continue') {
    if (actor === 'arl') {
      return `ARL is ready to ${label}.`;
    }

    if (actor === 'human') {
      return `ARL cannot cross this human accountability gate automatically. The next step is to ${label}.`;
    }

    return `ARL cannot advance this step without your input. The next step is to ${label}.`;
  }

  if (command === 'status') {
    return `Current assessment state: ${current}. Next: ${label}.`;
  }

  return `Assessment state loaded: ${current}. Next: ${label}.`;
}

function findingsMessage({ workflowState, label }) {
  const summary = buildFindingSummary(workflowState);

  if (!summary.authoritativeStateAvailable) {
    return `ARL cannot present current findings until authoritative Control Intelligence state is available. Next: ${label}.`;
  }

  if (
    summary.pendingCreationCount > 0 &&
    summary.activeCount > 0
  ) {
    return `ARL has ${summary.activeCount} active finding${summary.activeCount === 1 ? '' : 's'} in remediation/retest and ${summary.pendingCreationCount} reproduced failure${summary.pendingCreationCount === 1 ? '' : 's'} still awaiting authoritative finding creation. Next: ${label}.`;
  }

  if (summary.pendingCreationCount > 0) {
    return `ARL has ${summary.pendingCreationCount} reproduced failure${summary.pendingCreationCount === 1 ? '' : 's'} awaiting authoritative finding creation. ARL will not present ${summary.pendingCreationCount === 1 ? 'it' : 'them'} as created findings before that transition is persisted. Next: ${label}.`;
  }

  if (summary.activeCount > 0) {
    return `ARL has ${summary.activeCount} active finding${summary.activeCount === 1 ? '' : 's'} in the current assessment scope: ${summary.remediationCount} awaiting remediation evidence and ${summary.retestCount} awaiting exact retest. Next: ${label}.`;
  }

  return `ARL does not currently surface an open finding in the authoritative assessment scope. Next: ${label}.`;
}

function remediationMessage({ workflowState, label }) {
  const summary = buildFindingSummary(workflowState);

  if (!summary.authoritativeStateAvailable) {
    return `ARL cannot prescribe remediation from conversation alone because authoritative Control Intelligence state is not available. Next: ${label}.`;
  }

  if (workflowState.stage === 'finding_creation_required') {
    return `A reproduced failure still requires authoritative finding creation. ARL will not invent remediation before the finding exists. Next: ${label}.`;
  }

  if (workflowState.stage === 'changed_system_snapshot_required') {
    return `Remediation implementation evidence is already recorded. ARL will not infer another fix; the next authoritative step is to ${label}.`;
  }

  if (workflowState.stage === 'exact_retest_required') {
    return `The remediation has advanced to exact retest. ARL will not invent another fix before the retest result. Next: ${label}.`;
  }

  if (summary.remediationCount > 0) {
    return `ARL has ${summary.remediationCount} active finding${summary.remediationCount === 1 ? '' : 's'} requiring remediation implementation evidence. The conversation layer does not invent a fix; remediation must be tied to the authoritative finding and evidence. Next: ${label}.`;
  }

  return `The current authoritative state does not require a remediation implementation step. ARL will not invent one. Next: ${label}.`;
}

function fixedMessage({ stage, label }) {
  if (stage === 'remediation_required') {
    return 'I will not treat “I fixed it” as proof or close the finding. Please provide remediation implementation evidence. ARL will verify the next authoritative state from evidence.';
  }

  if (stage === 'changed_system_snapshot_required') {
    return 'The remediation implementation evidence is already recorded. The next step is to capture a changed system snapshot before any retest.';
  }

  if (stage === 'exact_retest_required') {
    return 'The change is bound to a changed snapshot, but the finding is not closed. The next step is to authorise the exact retest.';
  }

  return `I will not treat “I fixed it” as evidence, finding closure, or readiness. The current authoritative state still requires you to ${label}.`;
}

function retestMessage({ workflowState, label }) {
  if (workflowState.stage === 'exact_retest_required') {
    return `An exact retest is required against the changed snapshot. ARL will not run it without the required authorisation. Next: ${label}.`;
  }

  if (workflowState.stage === 'changed_system_snapshot_required') {
    return `The exact retest cannot run yet because the changed system snapshot is not ready. Next: ${label}.`;
  }

  if (workflowState.stage === 'remediation_required') {
    return `The exact retest cannot run yet because remediation implementation evidence is still required. Next: ${label}.`;
  }

  if (workflowState.stage === 'finding_creation_required') {
    return `The exact retest cannot run yet because the reproduced failure still requires an authoritative finding. Next: ${label}.`;
  }

  return `No exact retest is currently authorised by the authoritative workflow state. Next: ${label}.`;
}

function readinessMessage({ workflowState, label }) {
  const summary = buildReadinessSummary(workflowState);

  if (!summary.available) {
    return `Control Intelligence readiness is not available yet. No deployment decision is inferred. Human review remains required. Next: ${label}.`;
  }

  if (!summary.decision) {
    return `Control Intelligence returned a readiness state that this conversation contract cannot safely present. No deployment decision is inferred. Human review remains required. Next: ${label}.`;
  }

  return `Control Intelligence readiness: ${summary.decision}. This is not the final deployment decision. Human review remains required. Next: ${label}.`;
}

function commandMessage({
  command,
  workflowState,
  actor,
  label
}) {
  if (command === 'findings') {
    return findingsMessage({
      workflowState,
      label
    });
  }

  if (command === 'remediation') {
    return remediationMessage({
      workflowState,
      label
    });
  }

  if (command === 'fixed') {
    return fixedMessage({
      stage: workflowState.stage,
      label
    });
  }

  if (command === 'retest') {
    return retestMessage({
      workflowState,
      label
    });
  }

  if (command === 'readiness') {
    return readinessMessage({
      workflowState,
      label
    });
  }

  return defaultMessage({
    command,
    stage: workflowState.stage,
    actor,
    label
  });
}

export function buildConversationResponse({
  command,
  workflowState
} = {}) {
  if (!SUPPORTED_COMMANDS.includes(command)) {
    throw new Error(`Unsupported conversation command: ${command}`);
  }

  if (!stateIsUsable(workflowState)) {
    return failClosedResponse(command, workflowState);
  }

  const action = workflowState.nextAllowedAction;
  const label = actionLabel(action);
  const actor = action.actor;
  const acknowledgementOnly = command === 'fixed';

  return {
    type: 'conversation_response',
    schema: CONVERSATION_RESPONSE_SCHEMA,
    command,
    stage: workflowState.stage,
    status: responseStatus(actor),
    message: commandMessage({
      command,
      workflowState,
      actor,
      label
    }),
    nextStep: {
      actor,
      label,
      requiresUserInput:
        action.requiresUserInput === true
    },
    publicSummary:
      publicSummaryForCommand(
        command,
        workflowState
      ),
    needsUserAction:
      actor !== 'arl' ||
      action.requiresUserInput === true,
    canAutoAdvance:
      actor === 'arl' &&
      action.requiresUserInput === false,
    acknowledgementOnly,
    securityStateChanged: false,
    deploymentDecisionMade: false,
    humanReviewRequired: true
  };
}

export function renderConversationAnswer(response) {
  if (
    response?.schema !== CONVERSATION_RESPONSE_SCHEMA ||
    typeof response?.message !== 'string'
  ) {
    throw new Error('Invalid conversation response');
  }

  return response.message;
}
