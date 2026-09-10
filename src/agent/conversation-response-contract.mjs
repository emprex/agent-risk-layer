export const PUBLIC_ASSESSMENT_CONTRACT_SCHEMA =
  'arl.agent.public-assessment-state.v1';

const WORKFLOW_STATE_SCHEMA =
  'arl.agent.workflow-state.v1';

const CONVERSATION_RESPONSE_SCHEMA =
  'arl.agent.conversation-response.v1';

const REMAINING_PROOF = Object.freeze({
  authoritative_identity_required:
    'The authoritative assessment identity is incomplete.',
  assessment_context_required:
    'The authoritative project snapshot is not yet available.',
  authoritative_assessment_required:
    'A persisted authoritative assessment is not yet selected.',
  target_context_binding_required:
    'The frozen target is not yet verified against the authoritative context.',
  assessment_context_binding_required:
    'The assessment is not yet verified against the active system snapshot.',
  evidence_plan_required:
    'The authoritative Evidence Plan is not yet available.',
  control_applicability_required:
    'Control applicability is not yet authoritatively resolved.',
  source_evidence_required:
    'Required frozen-source evidence is not yet sufficient.',
  bounded_test_required:
    'The required bounded test has not yet been authoritatively completed.',
  control_test_required:
    'The required authoritative control test has not yet been completed.',
  evidence_recording_required:
    'Qualifying evidence is not yet authoritatively bound to the control.',
  finding_creation_required:
    'A reproduced failure has not yet been persisted as an authoritative finding.',
  remediation_required:
    'Remediation implementation evidence is not yet authoritative.',
  changed_system_snapshot_required:
    'A changed system snapshot has not yet been captured after remediation.',
  exact_retest_required:
    'The exact retest has not yet been authoritatively completed against the changed snapshot.',
  exact_retest_completion_ready:
    'The persisted exact retest still needs authoritative verification and recording before the finding can close.',
  persisted_lineage_resolution_required:
    'More than one persisted authoritative lineage can satisfy the current workflow gate, so automatic continuation is blocked.',
  human_approval_required:
    'The required accountable human approval has not yet been recorded.',
  manual_evidence_required:
    'Required manual evidence remains unproven.',
  readiness_review:
    'The final deployment decision has not been made by an accountable human.'
});

function normaliseReadiness(value) {
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

function workflowStateUsable(workflowState) {
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

function conversationResponseUsable(response) {
  return Boolean(
    response &&
    response.schema === CONVERSATION_RESPONSE_SCHEMA &&
    typeof response.message === 'string' &&
    response.deploymentDecisionMade === false &&
    response.humanReviewRequired === true
  );
}

function knownProjection(workflowState) {
  const artifacts =
    workflowState?.authoritativeArtifacts || {};

  return {
    frozenTargetVerified:
      artifacts.frozenTarget?.inspectorBindingVerified === true,
    assessmentContextAvailable:
      artifacts.assessmentContext?.available === true,
    authoritativeAssessmentAvailable:
      artifacts.authoritativeAssessment?.available === true,
    targetContextBound:
      artifacts.bindings?.targetContextVerified === true,
    assessmentContextBound:
      artifacts.bindings?.assessmentContextVerified === true,
    evidencePlanAvailable:
      artifacts.evidencePlan?.available === true,
    controlIntelligenceAvailable:
      artifacts.controlIntelligence?.available === true
  };
}

function readinessSource(workflowState) {
  return (
    workflowState?.readiness ||
    workflowState?.authoritativeArtifacts?.readiness ||
    null
  );
}

function readinessProjection(workflowState) {
  const source = readinessSource(workflowState);
  const decision =
    source?.available === true
      ? normaliseReadiness(source.decision)
      : null;

  return {
    available:
      source?.available === true &&
      decision !== null,
    decision,
    finalDeploymentDecisionMade: false
  };
}

function readinessPublicSummary(source, decision) {
  return {
    readiness: {
      available:
        source?.available === true &&
        decision !== null,
      decision,
      humanReviewRequired: true,
      finalDeploymentDecisionMade: false
    }
  };
}

function readinessMessage({ source, decision }) {
  if (source?.available !== true) {
    return [
      'ARL readiness: unavailable',
      '',
      'Control Intelligence readiness is not available for the current authoritative state. ARL will not infer a deployment recommendation.',
      '',
      'Final deployment decision: not made.',
      'Human review required: YES.'
    ].join('\n');
  }

  if (!decision) {
    return [
      'ARL readiness: unavailable',
      '',
      'Control Intelligence returned a readiness value outside the supported contract. ARL will not reinterpret it or infer a deployment recommendation.',
      '',
      'Final deployment decision: not made.',
      'Human review required: YES.'
    ].join('\n');
  }

  const rationale =
    typeof source.rationale === 'string' &&
    source.rationale.trim()
      ? source.rationale.trim()
      : 'This readiness value is projected directly from authoritative Control Intelligence state.';

  return [
    `ARL readiness: ${decision}`,
    '',
    rationale,
    '',
    'Final deployment decision: not made.',
    'Human review required: YES.'
  ].join('\n');
}

function projectReadinessHumanDecisionUx({
  workflowState,
  conversationResponse
}) {
  if (conversationResponse?.command !== 'readiness') {
    return conversationResponse;
  }

  const source = readinessSource(workflowState);
  const decision =
    source?.available === true
      ? normaliseReadiness(source.decision)
      : null;
  const recognised =
    source?.available === true &&
    decision !== null;

  return {
    ...conversationResponse,
    status:
      recognised
        ? conversationResponse.status
        : 'blocked',
    message: readinessMessage({
      source,
      decision
    }),
    publicSummary:
      readinessPublicSummary(source, decision),
    needsUserAction:
      recognised
        ? conversationResponse.needsUserAction
        : true,
    canAutoAdvance: false,
    securityStateChanged: false,
    deploymentDecisionMade: false,
    humanReviewRequired: true
  };
}

function requiredActionProjection(conversationResponse) {
  const nextStep = conversationResponse?.nextStep;

  if (!nextStep) {
    return null;
  }

  return {
    actor: nextStep.actor,
    label: nextStep.label,
    requiresUserInput:
      nextStep.requiresUserInput === true
  };
}

export function buildPublicAssessmentContract({
  workflowState,
  conversationResponse,
  workflowExecution = null
} = {}) {
  if (
    !workflowStateUsable(workflowState) ||
    !conversationResponseUsable(conversationResponse)
  ) {
    return {
      schema: PUBLIC_ASSESSMENT_CONTRACT_SCHEMA,
      available: false,
      stage:
        workflowState?.stage || 'unavailable',
      known: {
        frozenTargetVerified: false,
        assessmentContextAvailable: false,
        authoritativeAssessmentAvailable: false,
        targetContextBound: false,
        assessmentContextBound: false,
        evidencePlanAvailable: false,
        controlIntelligenceAvailable: false
      },
      remainsUnproven: [
        'The authoritative workflow state is unavailable or invalid.'
      ],
      requiredAction: null,
      readiness: {
        available: false,
        decision: null,
        finalDeploymentDecisionMade: false
      },
      automaticActionsExecuted: 0,
      securityStateChanged: false,
      humanReviewRequired: true
    };
  }

  const remaining =
    REMAINING_PROOF[workflowState.stage] ||
    'The authoritative workflow still contains an unresolved step.';

  return {
    schema: PUBLIC_ASSESSMENT_CONTRACT_SCHEMA,
    available: true,
    stage: workflowState.stage,
    known: knownProjection(workflowState),
    remainsUnproven: [remaining],
    requiredAction:
      requiredActionProjection(conversationResponse),
    readiness:
      readinessProjection(workflowState),
    automaticActionsExecuted:
      Number(workflowExecution?.executedActionCount || 0),
    securityStateChanged:
      workflowExecution?.securityStateChanged === true,
    humanReviewRequired: true
  };
}

export function attachPublicAssessmentContract({
  workflowState,
  conversationResponse,
  workflowExecution = null
} = {}) {
  const projectedResponse =
    projectReadinessHumanDecisionUx({
      workflowState,
      conversationResponse
    });

  return {
    ...projectedResponse,
    assessment:
      buildPublicAssessmentContract({
        workflowState,
        conversationResponse: projectedResponse,
        workflowExecution
      })
  };
}
