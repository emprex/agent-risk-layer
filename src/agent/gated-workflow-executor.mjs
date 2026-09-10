export const GATED_WORKFLOW_EXECUTION_SCHEMA =
  'arl.agent.workflow-execution.v1';

const WORKFLOW_STATE_SCHEMA =
  'arl.agent.workflow-state.v1';

const AUTO_EXECUTABLE_ACTIONS = new Set([
  'build_authoritative_evidence_plan',
  'run_frozen_source_inspection',
  'record_authoritative_evidence',
  'create_authoritative_finding',
  'complete_authoritative_retest'
]);

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

function stateFingerprint(workflowState) {
  const action = workflowState?.nextAllowedAction || {};
  const scopedControl = workflowState?.scopedControl || {};

  return JSON.stringify({
    stage: workflowState?.stage || null,
    actionName: action.name || null,
    actor: action.actor || null,
    requiresUserInput:
      action.requiresUserInput === true,
    controlId:
      scopedControl.controlId ||
      action.controlId ||
      null,
    controlStage:
      scopedControl.currentStage || null,
    readiness:
      workflowState?.readiness?.decision || null
  });
}

function executionResult({
  status,
  reason,
  workflowState,
  trace,
  blockedBy = null
}) {
  return {
    type: 'workflow_execution',
    schema: GATED_WORKFLOW_EXECUTION_SCHEMA,
    status,
    reason,
    blockedBy,
    executedActions: trace,
    executedActionCount: trace.length,
    securityStateChanged:
      trace.some(
        (item) => item.securityStateChanged === true
      ),
    workflowState,
    deploymentDecisionWritten: false,
    humanReviewRequired: true
  };
}

export async function executeGatedWorkflow({
  initialState,
  loadState,
  executeAction,
  maxSteps = 8
} = {}) {
  if (typeof loadState !== 'function') {
    throw new Error('loadState is required');
  }

  if (typeof executeAction !== 'function') {
    throw new Error('executeAction is required');
  }

  if (
    !Number.isInteger(maxSteps) ||
    maxSteps < 1 ||
    maxSteps > 32
  ) {
    throw new Error('maxSteps must be an integer between 1 and 32');
  }

  let workflowState = initialState;
  const trace = [];

  for (let step = 0; step < maxSteps; step += 1) {
    if (!stateIsUsable(workflowState)) {
      return executionResult({
        status: 'blocked',
        reason: 'invalid_authoritative_workflow_state',
        workflowState,
        trace,
        blockedBy: 'authority_state'
      });
    }

    const action = workflowState.nextAllowedAction;

    if (
      action.actor !== 'arl' ||
      action.requiresUserInput === true
    ) {
      return executionResult({
        status: 'gate_reached',
        reason:
          action.actor === 'human'
            ? 'human_action_required'
            : 'user_action_required',
        workflowState,
        trace,
        blockedBy: action.actor
      });
    }

    if (!AUTO_EXECUTABLE_ACTIONS.has(action.name)) {
      return executionResult({
        status: 'blocked',
        reason: 'unsupported_automatic_arl_action',
        workflowState,
        trace,
        blockedBy: 'arl_action_contract'
      });
    }

    let actionResult;

    try {
      actionResult = await executeAction({
        action,
        workflowState
      });
    } catch (error) {
      return executionResult({
        status: 'blocked',
        reason:
          error?.code ||
          'automatic_arl_action_failed',
        workflowState,
        trace,
        blockedBy: 'arl_action_execution'
      });
    }

    if (actionResult?.executed !== true) {
      return executionResult({
        status: 'blocked',
        reason:
          actionResult?.reason ||
          'automatic_arl_action_not_executed',
        workflowState,
        trace,
        blockedBy: 'arl_action_execution'
      });
    }

    trace.push({
      step: step + 1,
      stage: workflowState.stage,
      action: action.name,
      outcome: 'executed',
      securityStateChanged:
        actionResult.securityStateChanged === true
    });

    const reloadedState = await loadState();

    if (!stateIsUsable(reloadedState)) {
      return executionResult({
        status: 'blocked',
        reason: 'reloaded_authoritative_workflow_state_invalid',
        workflowState: reloadedState,
        trace,
        blockedBy: 'authority_state'
      });
    }

    if (
      stateFingerprint(reloadedState) ===
      stateFingerprint(workflowState)
    ) {
      return executionResult({
        status: 'blocked',
        reason: 'no_authoritative_state_progress',
        workflowState: reloadedState,
        trace,
        blockedBy: 'authority_state'
      });
    }

    workflowState = reloadedState;
  }

  return executionResult({
    status: 'blocked',
    reason: 'automatic_step_limit_reached',
    workflowState,
    trace,
    blockedBy: 'safety_limit'
  });
}