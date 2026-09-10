import {
  recordControlTestExecution
} from '../../control-intelligence.js';

import {
  getAssessmentControlBinding
} from '../assessment-control-bindings.mjs';

import {
  recordAuthoritativeControlEvidence
} from './record-authoritative-control-evidence.mjs';

export async function recordAuthoritativeRedTeamEvidence({
  projectId,
  userId,
  assessmentContext,
  assessmentWorkflow,
  evidencePlan,
  redTeamOutcome
} = {}) {
  if (!redTeamOutcome?.available) {
    return {
      type: 'authoritative_redteam_evidence',
      available: false,
      reason: 'authoritative_redteam_outcome_required'
    };
  }

  if (
    redTeamOutcome.signatureValid !== true ||
    redTeamOutcome.targetEvidence !== true ||
    !redTeamOutcome.bundleDigest
  ) {
    return {
      type: 'authoritative_redteam_evidence',
      available: false,
      reason: 'qualifying_redteam_target_evidence_required',
      runId: redTeamOutcome.runId || null,
      caseId: redTeamOutcome.caseId || null
    };
  }

  if (
    !assessmentWorkflow ||
    assessmentWorkflow.canContinue !== true
  ) {
    return {
      type: 'authoritative_redteam_evidence',
      available: false,
      reason: 'assessment_workflow_not_ready'
    };
  }

  const questionId =
    redTeamOutcome.questionId;

  const binding =
    getAssessmentControlBinding(
      questionId
    );

  if (!binding.available) {
    return {
      type: 'authoritative_redteam_evidence',
      available: false,
      reason: binding.reason,
      questionId
    };
  }

  if (
    !assessmentContext?.available ||
    !assessmentContext.systemSnapshotId
  ) {
    return {
      type: 'authoritative_redteam_evidence',
      available: false,
      reason: 'authoritative_system_snapshot_required'
    };
  }

  const passed =
    redTeamOutcome.status === 'passed';

  const failed =
    redTeamOutcome.status === 'failed';

  if (!passed && !failed) {
    return {
      type: 'authoritative_redteam_evidence',
      available: false,
      reason: 'redteam_outcome_unresolved'
    };
  }

  const execution =
    await recordControlTestExecution({
      projectId,
      controlId:
        binding.controlId,
      userId,

      input: {
        systemSnapshotId:
          assessmentContext.systemSnapshotId,

        result:
          passed ? 'passed' : 'failed',

        executionMethod:
          'bounded_redteam',

        inputReference:
          `${redTeamOutcome.caseId}:${redTeamOutcome.bundleDigest}`,

        expectedResult:
          'The bounded adversarial case is denied before unauthorised execution or side effect.',

        observedResult:
          passed
            ? 'The bounded adversarial case was denied within the tested scope.'
            : 'The bounded adversarial case produced a confirmed policy failure within the tested scope.',

        limitations:
          redTeamOutcome.trustBoundary ||
          'Customer-operated bounded Red Team evidence. This result applies only to the exact tested case, target version, snapshot and authorised scope.',

        failureReason:
          failed
            ? `Confirmed bounded Red Team failure: ${redTeamOutcome.caseId}`
            : ''
      }
    });

  const evidence =
    await recordAuthoritativeControlEvidence({
      projectId,
      userId,

      assessmentContext,
      assessmentWorkflow,
      evidencePlan,

      questionId,

      sourceType:
        'redteam_run',

      sourceReference:
        `redteam:${redTeamOutcome.runId}:${redTeamOutcome.caseId}:${redTeamOutcome.bundleDigest}`,

      testExecutionId:
        execution.id,

      limitations:
        'Integrity-verified customer-operated Red Team result linked to the exact bounded test execution. It does not prove absence of other attack paths.'
    });

  if (!evidence?.available) {
    return {
      type: 'authoritative_redteam_evidence',
      available: false,
      reason: evidence?.reason || 'control_evidence_recording_failed',
      runId: redTeamOutcome.runId,
      caseId: redTeamOutcome.caseId,
      questionId,
      controlId: binding.controlId,
      testExecutionId: execution.id
    };
  }

  return {
    type: 'authoritative_redteam_evidence',
    available: true,

    runId:
      redTeamOutcome.runId,

    caseId:
      redTeamOutcome.caseId,

    questionId,

    controlId:
      binding.controlId,

    result:
      passed ? 'passed' : 'failed',

    testExecutionId:
      execution.id,

    evidenceId:
      evidence.evidenceId,

    verificationState:
      evidence.verificationState,

    integrityDigest:
      evidence.integrityDigest,

    bundleDigest:
      redTeamOutcome.bundleDigest,

    evidenceClass:
      redTeamOutcome.evidenceClass || null,

    findingRequired:
      failed
  };
}
