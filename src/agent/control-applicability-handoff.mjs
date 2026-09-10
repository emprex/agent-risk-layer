import {
  assessControlApplicability,
  getControlIntelligenceControl
} from '../control-intelligence.js';

import {
  getAssessmentContext
} from './tools/get-assessment-context.mjs';

export const CONTROL_APPLICABILITY_HANDOFF_SCHEMA =
  'arl.agent.control-applicability-handoff.v1';

export const CONTROL_APPLICABILITY_EXECUTION_SCHEMA =
  'arl.agent.control-applicability-execution.v1';

const APPLICABILITY_DECISIONS = new Set([
  'applicable',
  'not_applicable',
  'context_required'
]);

function normalise(text) {
  return String(text || '')
    .trim()
    .toLowerCase()
    .replace(/[—–]/g, '-')
    .replace(/\s+/g, ' ');
}

function clean(value) {
  return String(value ?? '').trim();
}

export function detectControlApplicabilityCommand(userRequest) {
  const text = normalise(userRequest);

  if (!text) {
    return null;
  }

  if (
    /^(?:this\s+)?control\s+(?:is\s+)?(?:applicable|applies)[.!?]*$/.test(text) ||
    /^confirm\s+(?:this\s+)?control\s+(?:is\s+)?(?:applicable|applies)[.!?]*$/.test(text) ||
    /^applicable[.!?]*$/.test(text)
  ) {
    return 'control_applicability_confirm';
  }

  return null;
}

function execution(changed, decision = null) {
  return {
    type: 'control_applicability_execution',
    schema: CONTROL_APPLICABILITY_EXECUTION_SCHEMA,
    status:
      changed
        ? 'applicability_recorded'
        : 'already_recorded',
    executedActionCount: changed ? 1 : 0,
    executedActions:
      changed
        ? [
            {
              action:
                'record_guided_customer_applicability',
              outcome: 'executed',
              applicabilityDecision: decision,
              securityStateChanged: true
            }
          ]
        : [],
    securityStateChanged: changed,
    deploymentDecisionWritten: false,
    humanReviewRequired: true
  };
}

function unavailable(reason) {
  return {
    type: 'control_applicability_handoff',
    schema: CONTROL_APPLICABILITY_HANDOFF_SCHEMA,
    available: false,
    status: 'blocked',
    reason,
    securityStateChanged: false,
    execution: execution(false),
    deploymentDecisionWritten: false,
    humanReviewRequired: true
  };
}

function explicitReason(decision, reason) {
  const supplied = clean(reason);
  if (decision === 'applicable') {
    return supplied ||
      'The customer explicitly confirmed that this Evidence Plan control applies to the current declared agent architecture and assessment scope.';
  }
  return supplied;
}

export async function recordControlApplicabilityConfirmation({
  workflowState,
  projectId,
  userId,
  decision = 'applicable',
  reason = '',
  architectureFactIds = null
} = {}) {
  if (!projectId || !userId) {
    return unavailable(
      'authoritative_applicability_identity_required'
    );
  }

  const requestedDecision = normalise(decision).replaceAll(' ', '_');
  if (!APPLICABILITY_DECISIONS.has(requestedDecision)) {
    return unavailable(
      'guided_customer_applicability_decision_required'
    );
  }

  const requestedReason = explicitReason(requestedDecision, reason);
  if (
    ['not_applicable', 'context_required'].includes(requestedDecision) &&
    requestedReason.length < 10
  ) {
    return unavailable(
      requestedDecision === 'not_applicable'
        ? 'guided_customer_not_applicable_reason_required'
        : 'guided_customer_missing_context_required'
    );
  }

  if (
    workflowState?.stage !==
      'control_applicability_required' ||
    workflowState?.nextAllowedAction?.name !==
      'resolve_control_applicability' ||
    workflowState?.nextAllowedAction?.actor !== 'user' ||
    workflowState?.nextAllowedAction?.requiresUserInput !== true ||
    !workflowState?.scopedControl?.controlId
  ) {
    return unavailable(
      'guided_customer_applicability_gate_required'
    );
  }

  const controlId =
    workflowState.scopedControl.controlId;
  const assessmentContext =
    await getAssessmentContext({
      projectId,
      userId
    });

  if (!assessmentContext.available) {
    return unavailable(
      assessmentContext.reason ||
      'authoritative_assessment_context_required'
    );
  }

  const expectedSnapshotId =
    workflowState?.authoritativeArtifacts
      ?.assessmentContext?.systemSnapshotId || null;

  if (
    !expectedSnapshotId ||
    assessmentContext.systemSnapshotId !==
      expectedSnapshotId
  ) {
    return unavailable(
      'applicability_snapshot_binding_mismatch'
    );
  }

  const detail =
    await getControlIntelligenceControl({
      projectId,
      controlId,
      userId
    });

  if (
    detail?.systemSnapshot?.id !==
      expectedSnapshotId
  ) {
    return unavailable(
      'current_applicability_snapshot_required'
    );
  }

  const currentApplicability =
    detail?.applicability?.status || null;
  const currentReason =
    clean(detail?.applicability?.reason);
  if (
    currentApplicability === requestedDecision &&
    (
      detail?.chain?.currentStage !== 'applicability' ||
      (
        requestedDecision === 'context_required' &&
        currentReason === requestedReason
      )
    )
  ) {
    return {
      type: 'control_applicability_handoff',
      schema: CONTROL_APPLICABILITY_HANDOFF_SCHEMA,
      available: true,
      status: 'already_recorded',
      reason:
        'guided_customer_applicability_already_recorded',
      controlId,
      systemSnapshotId: expectedSnapshotId,
      applicabilityDecision: requestedDecision,
      securityStateChanged: false,
      execution: execution(false, requestedDecision),
      deploymentDecisionWritten: false,
      humanReviewRequired: true
    };
  }

  if (
    detail?.chain?.currentStage !== 'applicability'
  ) {
    return unavailable(
      'control_not_at_applicability_gate'
    );
  }

  const architectureFacts =
    Array.isArray(
      assessmentContext?.assessmentConfiguration
        ?.architectureFacts
    )
      ? assessmentContext.assessmentConfiguration
          .architectureFacts
          .map((value) => clean(value))
          .filter(Boolean)
      : [];
  const authoritativeFacts = new Set(architectureFacts);
  const suppliedFacts = Array.isArray(architectureFactIds)
    ? [...new Set(
        architectureFactIds
          .map((value) => clean(value))
          .filter(Boolean)
      )].sort()
    : null;
  const selectedFacts = suppliedFacts ||
    (requestedDecision === 'not_applicable' ? architectureFacts : []);

  if (selectedFacts.some((fact) => !authoritativeFacts.has(fact))) {
    return unavailable(
      'guided_customer_applicability_fact_not_confirmed'
    );
  }
  if (
    requestedDecision === 'not_applicable' &&
    !selectedFacts.length
  ) {
    return unavailable(
      'guided_customer_not_applicable_fact_required'
    );
  }

  const recorded =
    await assessControlApplicability({
      projectId,
      controlId,
      userId,
      input: {
        snapshotId: expectedSnapshotId,
        decision: requestedDecision,
        reason: requestedReason,
        architectureFactIds: selectedFacts,
        expectedEvaluationDigest:
          detail.applicability.evaluationDigest
      }
    });

  return {
    type: 'control_applicability_handoff',
    schema: CONTROL_APPLICABILITY_HANDOFF_SCHEMA,
    available: true,
    status: 'applicability_recorded',
    reason:
      'guided_customer_applicability_recorded',
    controlId,
    systemSnapshotId: expectedSnapshotId,
    applicabilityDecision:
      recorded?.evaluation?.decision || requestedDecision,
    applicabilityReason:
      recorded?.evaluation?.reason || requestedReason,
    securityStateChanged: true,
    execution: execution(true, requestedDecision),
    deploymentDecisionWritten: false,
    humanReviewRequired: true
  };
}
