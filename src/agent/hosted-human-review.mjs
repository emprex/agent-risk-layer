import {
  recordDeploymentDecision
} from '../control-intelligence.js';

import {
  advanceAuthoritativeAssessmentWorkflow
} from './authoritative-assessment-workflow.mjs';

import {
  buildCustomerAssessmentReport
} from './customer-assessment-report.mjs';

import {
  resolvePersistedExactRetestContinuation
} from './tools/resolve-persisted-exact-retest-continuation.mjs';

export const HOSTED_HUMAN_REVIEW_SCHEMA =
  'arl.agent.hosted-human-review.v1';

function clean(value, maxLength = 3000) {
  return String(value ?? '')
    .trim()
    .replace(/\s+/g, ' ')
    .slice(0, maxLength);
}

function blocked(reason, extra = {}) {
  return {
    schema: HOSTED_HUMAN_REVIEW_SCHEMA,
    available: false,
    reason,
    securityStateChanged: false,
    deploymentDecisionWritten: false,
    humanReviewRequired: true,
    ...extra
  };
}

function exactHumanAction(workflowState) {
  const action =
    workflowState?.nextAllowedAction || null;

  return {
    stage: workflowState?.stage || null,
    name: action?.name || null,
    actor: action?.actor || null,
    requiresUserInput:
      action?.requiresUserInput === true,
    controlId: action?.controlId || null,
    caseId: action?.caseId || null
  };
}

export function humanFindingClosureGate({
  workflowState,
  confirmed
} = {}) {
  const action =
    exactHumanAction(workflowState);

  if (confirmed !== true) {
    return blocked(
      'explicit_human_finding_closure_confirmation_required',
      { action }
    );
  }

  if (
    action.stage !== 'human_approval_required' ||
    action.name !==
      'record_required_human_approval' ||
    action.actor !== 'human' ||
    action.requiresUserInput !== true
  ) {
    return blocked(
      'authoritative_human_closure_gate_required',
      { action }
    );
  }

  if (!action.controlId || !action.caseId) {
    return blocked(
      'authoritative_human_closure_mapping_required',
      { action }
    );
  }

  return {
    schema: HOSTED_HUMAN_REVIEW_SCHEMA,
    available: true,
    status: 'human_closure_gate_satisfied',
    action,
    securityStateChanged: false,
    deploymentDecisionWritten: false,
    humanReviewRequired: true
  };
}

export async function completeHostedHumanFindingClosure({
  workflowState,
  preparation,
  operatorContext,
  confirmed,
  limitations = ''
} = {}) {
  const gate =
    humanFindingClosureGate({
      workflowState,
      confirmed
    });

  if (gate.available !== true) {
    return gate;
  }

  const projectId =
    operatorContext?.projectId || null;
  const userId =
    operatorContext?.userId || null;
  const assessmentId =
    operatorContext?.assessmentId || null;

  if (!projectId || !userId || !assessmentId) {
    return blocked(
      'authoritative_human_closure_identity_required'
    );
  }

  const evidencePlan =
    preparation?.evidencePlan || null;

  if (
    preparation?.assessmentContext?.available !== true ||
    preparation?.assessmentWorkflow?.canContinue !== true ||
    evidencePlan?.available !== true
  ) {
    return blocked(
      'authoritative_human_closure_preparation_required'
    );
  }

  const continuation =
    await resolvePersistedExactRetestContinuation({
      projectId,
      userId,
      assessmentId,
      evidencePlan,
      caseId:
        gate.action.caseId,
      controlId:
        gate.action.controlId
    });

  if (continuation.available !== true) {
    return blocked(
      continuation.reason ||
        'authoritative_exact_retest_lineage_required',
      {
        candidateCount:
          continuation.candidateCount || 0
      }
    );
  }

  if (
    !continuation.findingId ||
    !continuation.baselineRunId ||
    !continuation.retestRunId ||
    continuation.controlId !==
      gate.action.controlId ||
    continuation.caseId !==
      gate.action.caseId
  ) {
    return blocked(
      'authoritative_human_closure_lineage_mismatch'
    );
  }

  const completed =
    await advanceAuthoritativeAssessmentWorkflow({
      projectId,
      userId,
      assessmentId,
      assessmentContext:
        preparation.assessmentContext,
      assessmentWorkflow:
        preparation.assessmentWorkflow,
      evidencePlan,
      baselineRunId:
        continuation.baselineRunId,
      retestRunId:
        continuation.retestRunId,
      redTeamCaseId:
        continuation.caseId,
      findingId:
        continuation.findingId
    });

  if (
    completed?.available !== true ||
    completed?.stage !==
      'finding_verified_closed' ||
    completed?.retest?.findingStatus !==
      'verified_closed'
  ) {
    return blocked(
      completed?.reason ||
        'authoritative_human_closure_not_completed'
    );
  }

  return {
    schema: HOSTED_HUMAN_REVIEW_SCHEMA,
    available: true,
    status: 'finding_verified_closed',
    reason:
      'authenticated_human_approved_exact_retest_closure',
    controlId:
      completed.controlId ||
      continuation.controlId,
    caseId:
      continuation.caseId,
    findingId:
      completed.findingId ||
      continuation.findingId,
    baselineRunId:
      continuation.baselineRunId,
    retestRunId:
      continuation.retestRunId,
    findingStatus: 'verified_closed',
    reviewer:
      'authenticated_hosted_operator',
    limitations:
      clean(limitations, 1000) || null,
    securityStateChanged:
      completed.alreadyCompleted !== true,
    deploymentDecisionWritten: false,
    humanReviewRequired: true
  };
}

export function readinessRecordGate({
  workflowState,
  confirmed,
  rationale
} = {}) {
  const action =
    exactHumanAction(workflowState);
  const reason =
    clean(rationale, 3000);

  if (confirmed !== true) {
    return blocked(
      'explicit_human_readiness_record_confirmation_required',
      { action }
    );
  }

  if (
    action.stage !== 'readiness_review' ||
    action.name !==
      'review_current_arl_readiness' ||
    action.actor !== 'human' ||
    action.requiresUserInput !== true
  ) {
    return blocked(
      'authoritative_readiness_review_gate_required',
      { action }
    );
  }

  if (!reason) {
    return blocked(
      'human_readiness_rationale_required',
      { action }
    );
  }

  const systemSnapshotId =
    workflowState?.authoritativeArtifacts
      ?.controlIntelligence
      ?.systemSnapshotId ||
    workflowState?.authoritativeArtifacts
      ?.assessmentContext
      ?.systemSnapshotId ||
    null;

  if (!systemSnapshotId) {
    return blocked(
      'authoritative_readiness_snapshot_required',
      { action }
    );
  }

  return {
    schema: HOSTED_HUMAN_REVIEW_SCHEMA,
    available: true,
    status:
      'human_readiness_record_gate_satisfied',
    action,
    rationale: reason,
    systemSnapshotId,
    securityStateChanged: false,
    deploymentDecisionWritten: false,
    humanReviewRequired: true
  };
}

function publicDecision(decision) {
  if (!decision) return null;

  return {
    decision:
      decision.decision || null,
    status:
      decision.status || null,
    rationale:
      decision.rationale || null,
    decisionMethod:
      decision.decisionMethod || null,
    decidedAt:
      decision.decidedAt || null,
    expiresAt:
      decision.expiresAt || null,
    reassessmentTrigger:
      decision.reassessmentTrigger || null,
    humanTriggered: true,
    outcomeSource:
      'server_derived_control_intelligence'
  };
}

export async function recordHostedHumanReadinessDecision({
  workflowState,
  operatorContext,
  confirmed,
  rationale
} = {}) {
  const gate =
    readinessRecordGate({
      workflowState,
      confirmed,
      rationale
    });

  if (gate.available !== true) {
    return gate;
  }

  const projectId =
    operatorContext?.projectId || null;
  const userId =
    operatorContext?.userId || null;

  if (!projectId || !userId) {
    return blocked(
      'authoritative_readiness_identity_required'
    );
  }

  const existingReport =
    await buildCustomerAssessmentReport({
      projectId,
      userId,
      workflowState
    });

  if (
    existingReport?.available === true &&
    existingReport?.readiness
      ?.finalDecisionRecorded === true
  ) {
    return {
      schema: HOSTED_HUMAN_REVIEW_SCHEMA,
      available: true,
      status:
        'readiness_decision_already_recorded',
      alreadyRecorded: true,
      decision:
        existingReport.readiness
          .recordedDecision,
      securityStateChanged: false,
      deploymentDecisionWritten: false,
      humanReviewRequired: true
    };
  }

  const recorded =
    await recordDeploymentDecision({
      projectId,
      userId,
      input: {
        systemSnapshotId:
          gate.systemSnapshotId,
        rationale:
          gate.rationale
      }
    });

  return {
    schema: HOSTED_HUMAN_REVIEW_SCHEMA,
    available: true,
    status:
      'human_triggered_readiness_decision_recorded',
    alreadyRecorded: false,
    decision:
      publicDecision(recorded),
    securityStateChanged: true,
    deploymentDecisionWritten: true,
    humanReviewRequired: true,
    statement:
      'The authenticated human requested this record. The decision value itself is derived by authoritative Control Intelligence; the LLM did not choose the outcome.'
  };
}

export async function buildHostedCustomerAssessmentReport({
  workflowState,
  operatorContext
} = {}) {
  const projectId =
    operatorContext?.projectId || null;
  const userId =
    operatorContext?.userId || null;

  if (!projectId || !userId) {
    return blocked(
      'authoritative_report_identity_required'
    );
  }

  return buildCustomerAssessmentReport({
    projectId,
    userId,
    workflowState
  });
}
