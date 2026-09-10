import {
  getControlIntelligenceControl,
  recordControlEvidence
} from '../../control-intelligence.js';

import {
  getAssessmentControlBinding
} from '../assessment-control-bindings.mjs';

export async function recordAuthoritativeControlEvidence({
  projectId,
  userId,
  assessmentContext,
  assessmentWorkflow,
  evidencePlan,
  questionId,
  sourceType,
  sourceReference,
  limitations = '',
  observedAt = null,
  testExecutionId = null
} = {}) {
  if (!projectId || !userId) {
    return {
      type: 'authoritative_control_evidence',
      available: false,
      reason: 'project_identity_required'
    };
  }

  if (
    !assessmentWorkflow ||
    assessmentWorkflow.canContinue !== true
  ) {
    return {
      type: 'authoritative_control_evidence',
      available: false,
      reason: 'assessment_workflow_not_ready'
    };
  }

  if (
    !assessmentContext?.available ||
    !assessmentContext.systemSnapshotId
  ) {
    return {
      type: 'authoritative_control_evidence',
      available: false,
      reason: 'authoritative_system_snapshot_required'
    };
  }

  if (
    !evidencePlan?.available
  ) {
    return {
      type: 'authoritative_control_evidence',
      available: false,
      reason: 'authoritative_evidence_plan_required'
    };
  }

  const binding =
    getAssessmentControlBinding(questionId);

  if (!binding.available) {
    return {
      type: 'authoritative_control_evidence',
      available: false,
      reason: binding.reason,
      questionId: questionId || null
    };
  }

  const plannedGap =
    (evidencePlan.checks || [])
      .map((check) => check?.gap)
      .find(
        (gap) =>
          gap?.questionId === questionId
      );

  if (!plannedGap) {
    return {
      type: 'authoritative_control_evidence',
      available: false,
      reason: 'question_not_authorised_by_evidence_plan',
      questionId,
      controlId: binding.controlId
    };
  }

  if (!sourceType || !sourceReference) {
    return {
      type: 'authoritative_control_evidence',
      available: false,
      reason: 'evidence_source_required',
      questionId,
      controlId: binding.controlId
    };
  }

  /*
   * Important authority boundary:
   * the mapped ARL control must actually exist in the
   * current authoritative Control Intelligence snapshot.
   */
  const control =
    await getControlIntelligenceControl({
      projectId,
      controlId: binding.controlId,
      userId
    });

  if (
    !control?.systemSnapshot?.id ||
    control.systemSnapshot.id !==
      assessmentContext.systemSnapshotId
  ) {
    return {
      type: 'authoritative_control_evidence',
      available: false,
      reason: 'control_snapshot_binding_mismatch',
      questionId,
      controlId: binding.controlId
    };
  }

  const input = {
    systemSnapshotId:
      assessmentContext.systemSnapshotId,

    evidenceClass: 'observed',

    sourceType:
      String(sourceType),

    sourceReference:
      String(sourceReference),

    limitations:
      String(limitations || '')
  };

  if (observedAt) {
    input.observedAt = observedAt;
  }

  if (testExecutionId) {
    input.testExecutionId =
      testExecutionId;
  }

  const evidence =
    await recordControlEvidence({
      projectId,
      controlId: binding.controlId,
      userId,
      input
    });

  return {
    type: 'authoritative_control_evidence',
    available: true,

    questionId,
    controlId: binding.controlId,
    knowledgeVersion:
      binding.knowledgeVersion,

    systemSnapshotId:
      evidence.systemSnapshotId,

    evidenceId:
      evidence.id,

    evidenceClass:
      evidence.evidenceClass,

    verificationState:
      evidence.verificationState,

    sourceType:
      evidence.sourceType,

    sourceReference:
      evidence.sourceReference,

    integrityDigest:
      evidence.integrityDigest,

    observedAt:
      evidence.observedAt,

    limitations:
      evidence.limitations
  };
}
