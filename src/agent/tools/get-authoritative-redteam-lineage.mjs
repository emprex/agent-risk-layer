import {
  getControlIntelligenceControl
} from '../../control-intelligence.js';

import {
  getAssessmentControlBinding
} from '../assessment-control-bindings.mjs';

import {
  getAuthoritativeRedTeamOutcome
} from './get-authoritative-redteam-outcome.mjs';

function uniqueById(items = []) {
  const byId = new Map();
  for (const item of items) {
    if (item?.id && !byId.has(item.id)) byId.set(item.id, item);
  }
  return [...byId.values()];
}


export function redTeamEvidenceSemanticKey({
  evidenceItem,
  execution
} = {}) {
  return JSON.stringify({
    sourceType: evidenceItem?.sourceType || null,
    sourceReference: evidenceItem?.sourceReference || null,
    verificationState:
      evidenceItem?.verificationState || null,
    retentionStatus:
      evidenceItem?.retentionStatus || null,
    systemSnapshotId:
      execution?.systemSnapshotId || null,
    result: execution?.result || null,
    executionKind:
      execution?.executionKind || null,
    executionMethod:
      execution?.executionMethod || null,
    inputReference:
      execution?.inputReference || null,
    expectedResult:
      execution?.expectedResult || null,
    observedResult:
      execution?.observedResult || null,
    failureReason:
      execution?.failureReason || null
  });
}

export async function getAuthoritativeRedTeamLineage({
  projectId,
  userId,
  assessmentId = null,
  evidencePlan,
  runId,
  caseId
} = {}) {
  if (!projectId || !userId) {
    return {
      type: 'authoritative_redteam_lineage',
      available: false,
      reason: 'project_identity_required'
    };
  }

  const outcome =
    await getAuthoritativeRedTeamOutcome({
      runId,
      userId,
      assessmentId,
      evidencePlan,
      caseId
    });

  if (!outcome.available) {
    return {
      type: 'authoritative_redteam_lineage',
      available: false,
      reason: outcome.reason,
      runId: runId || null,
      caseId: caseId || null,
      outcome
    };
  }

  const binding =
    getAssessmentControlBinding(
      outcome.questionId
    );

  if (!binding?.available) {
    return {
      type: 'authoritative_redteam_lineage',
      available: false,
      reason: binding?.reason || 'assessment_control_binding_required',
      runId: outcome.runId,
      caseId: outcome.caseId,
      questionId: outcome.questionId
    };
  }

  const detail =
    await getControlIntelligenceControl({
      projectId,
      controlId: binding.controlId,
      userId
    });

  const expectedSourceReference =
    `redteam:${outcome.runId}:${outcome.caseId}:${outcome.bundleDigest}`;

  const evidence =
    uniqueById([
      ...(detail.evidence || []),
      ...(detail.evidenceHistory || [])
    ]).filter(
      (item) =>
        item.sourceType === 'redteam_run' &&
        item.sourceReference === expectedSourceReference
    );

  if (evidence.length === 0) {
    return {
      type: 'authoritative_redteam_lineage',
      available: false,
      reason: 'redteam_control_evidence_not_recorded',
      runId: outcome.runId,
      caseId: outcome.caseId,
      questionId: outcome.questionId,
      controlId: binding.controlId,
      outcome
    };
  }

  const tests =
    uniqueById([
      ...(detail.tests || []),
      ...(detail.testHistory || [])
    ]);

  const evidenceLineages =
    evidence.map((evidenceItem) => ({
      evidenceItem,
      execution:
        tests.find(
          (item) =>
            item.id === evidenceItem.testExecutionId
        ) || null
    }));

  const missingExecution =
    evidenceLineages.find(
      (item) => !item.execution
    );

  if (missingExecution) {
    return {
      type: 'authoritative_redteam_lineage',
      available: false,
      reason: 'redteam_test_execution_not_found',
      runId: outcome.runId,
      caseId: outcome.caseId,
      questionId: outcome.questionId,
      controlId: binding.controlId,
      evidenceId:
        missingExecution.evidenceItem.id,
      evidenceIds:
        evidence.map((item) => item.id),
      outcome
    };
  }

  const mismatchedExecution =
    evidenceLineages.find(
      (item) =>
        item.execution.result !== outcome.status
    );

  if (mismatchedExecution) {
    return {
      type: 'authoritative_redteam_lineage',
      available: false,
      reason:
        'redteam_test_execution_outcome_mismatch',
      runId: outcome.runId,
      caseId: outcome.caseId,
      questionId: outcome.questionId,
      controlId: binding.controlId,
      evidenceId:
        mismatchedExecution.evidenceItem.id,
      testExecutionId:
        mismatchedExecution.execution.id,
      evidenceIds:
        evidence.map((item) => item.id),
      outcome
    };
  }

  /*
   * Repeated workflow continuation may have persisted more than one
   * row for the exact same authoritative Red Team source lineage.
   *
   * Different row IDs alone do not make those records different
   * security evidence. Collapse them only when their material
   * semantics are identical. Any semantic difference remains
   * fail-closed as a real ambiguity.
   */
  const semanticKeys =
    new Set(
      evidenceLineages.map(
        ({ evidenceItem, execution }) =>
          redTeamEvidenceSemanticKey({
            evidenceItem,
            execution
          })
      )
    );

  if (semanticKeys.size !== 1) {
    return {
      type: 'authoritative_redteam_lineage',
      available: false,
      reason: 'redteam_control_evidence_ambiguous',
      runId: outcome.runId,
      caseId: outcome.caseId,
      questionId: outcome.questionId,
      controlId: binding.controlId,
      evidenceIds:
        evidence.map((item) => item.id),
      outcome
    };
  }

  /*
   * Equivalent duplicate rows represent one semantic lineage.
   * Pick the first persisted execution deterministically only after
   * equivalence has been proven.
   */
  evidenceLineages.sort((left, right) => {
    const timeOrder =
      String(left.execution.completedAt || '')
        .localeCompare(
          String(right.execution.completedAt || '')
        );

    if (timeOrder !== 0) {
      return timeOrder;
    }

    return String(left.evidenceItem.id)
      .localeCompare(
        String(right.evidenceItem.id)
      );
  });

  const evidenceItem =
    evidenceLineages[0].evidenceItem;

  const execution =
    evidenceLineages[0].execution;

  const findingId =
    execution.findingId || null;

  const finding =
    findingId
      ? (detail.findings || []).find(
          (item) => item.id === findingId
        ) || null
      : null;

  const recordedEvidence = {
    type: 'authoritative_redteam_evidence',
    available: true,
    runId: outcome.runId,
    caseId: outcome.caseId,
    questionId: outcome.questionId,
    controlId: binding.controlId,
    result: execution.result,
    testExecutionId: execution.id,
    evidenceId: evidenceItem.id,
    verificationState: evidenceItem.verificationState,
    integrityDigest: evidenceItem.integrityDigest,
    bundleDigest: outcome.bundleDigest,
    evidenceClass: outcome.evidenceClass || null,
    findingRequired: execution.result === 'failed'
  };

  return {
    type: 'authoritative_redteam_lineage',
    available: true,
    persisted: true,
    runId: outcome.runId,
    caseId: outcome.caseId,
    questionId: outcome.questionId,
    controlId: binding.controlId,
    outcome,
    redTeamEvidence: recordedEvidence,
    findingId,
    findingStatus: finding?.status || null,
    systemSnapshotId: detail.systemSnapshot?.id || null
  };
}
