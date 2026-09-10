import {
  closeControlFinding,
  getControlIntelligenceControl,
  recordControlEvidence,
  recordControlTestExecution
} from '../../control-intelligence.js';

import {
  getAssessmentControlBinding
} from '../assessment-control-bindings.mjs';

function clean(value) {
  return String(value ?? '').trim();
}

function targetIdentity(outcome) {
  const campaign = outcome?.campaign || {};
  const target = campaign?.target || {};
  return {
    mode: clean(target.mode),
    environment: clean(campaign.environment),
    endpointOrigin: clean(target.endpointOrigin),
    endpointPathHash: clean(target.endpointPathHash),
    profile: target.profile == null ? '' : clean(target.profile)
  };
}

function sameTarget(left, right) {
  const a = targetIdentity(left);
  const b = targetIdentity(right);
  return a.mode === b.mode &&
    a.environment === b.environment &&
    a.endpointOrigin === b.endpointOrigin &&
    a.endpointPathHash === b.endpointPathHash &&
    a.profile === b.profile;
}

export async function completeAuthoritativeRedTeamRetest({
  projectId,
  userId,
  assessmentContext,
  evidencePlan,
  failedRedTeamOutcome,
  retestRedTeamOutcome,
  failedRedTeamEvidence,
  findingId
} = {}) {
  if (!projectId || !userId) {
    return {
      type: 'authoritative_redteam_retest',
      available: false,
      reason: 'project_identity_required'
    };
  }

  if (
    !assessmentContext?.available ||
    !assessmentContext.systemSnapshotId
  ) {
    return {
      type: 'authoritative_redteam_retest',
      available: false,
      reason: 'authoritative_system_snapshot_required'
    };
  }

  if (!evidencePlan?.available) {
    return {
      type: 'authoritative_redteam_retest',
      available: false,
      reason: 'authoritative_evidence_plan_required'
    };
  }

  if (
    !failedRedTeamOutcome?.available ||
    failedRedTeamOutcome.status !== 'failed' ||
    failedRedTeamOutcome.signatureValid !== true ||
    failedRedTeamOutcome.targetEvidence !== true
  ) {
    return {
      type: 'authoritative_redteam_retest',
      available: false,
      reason: 'authoritative_failed_redteam_baseline_required'
    };
  }

  if (
    !retestRedTeamOutcome?.available ||
    retestRedTeamOutcome.status !== 'passed' ||
    retestRedTeamOutcome.signatureValid !== true ||
    retestRedTeamOutcome.targetEvidence !== true
  ) {
    return {
      type: 'authoritative_redteam_retest',
      available: false,
      reason: 'authoritative_passed_redteam_retest_required'
    };
  }

  if (
    !failedRedTeamEvidence?.available ||
    failedRedTeamEvidence.result !== 'failed' ||
    failedRedTeamEvidence.findingRequired !== true ||
    !failedRedTeamEvidence.testExecutionId ||
    !failedRedTeamEvidence.controlId
  ) {
    return {
      type: 'authoritative_redteam_retest',
      available: false,
      reason: 'failed_redteam_control_lineage_required'
    };
  }

  if (!findingId) {
    return {
      type: 'authoritative_redteam_retest',
      available: false,
      reason: 'finding_identity_required'
    };
  }

  const caseId = clean(failedRedTeamOutcome.caseId);
  const retestCaseId = clean(retestRedTeamOutcome.caseId);
  const questionId = clean(failedRedTeamOutcome.questionId);

  if (
    !caseId ||
    caseId !== retestCaseId ||
    questionId !== clean(retestRedTeamOutcome.questionId) ||
    caseId !== clean(failedRedTeamEvidence.caseId) ||
    failedRedTeamOutcome.runId !== failedRedTeamEvidence.runId
  ) {
    return {
      type: 'authoritative_redteam_retest',
      available: false,
      reason: 'redteam_exact_case_lineage_mismatch',
      caseId: caseId || null
    };
  }

  if (
    failedRedTeamOutcome.assessmentId &&
    retestRedTeamOutcome.assessmentId &&
    failedRedTeamOutcome.assessmentId !== retestRedTeamOutcome.assessmentId
  ) {
    return {
      type: 'authoritative_redteam_retest',
      available: false,
      reason: 'redteam_assessment_binding_mismatch',
      caseId
    };
  }

  if (
    !failedRedTeamOutcome.authorisationId ||
    failedRedTeamOutcome.authorisationId !== retestRedTeamOutcome.authorisationId
  ) {
    return {
      type: 'authoritative_redteam_retest',
      available: false,
      reason: 'redteam_rules_of_engagement_mismatch',
      caseId
    };
  }

  if (!sameTarget(failedRedTeamOutcome, retestRedTeamOutcome)) {
    return {
      type: 'authoritative_redteam_retest',
      available: false,
      reason: 'redteam_exact_target_mismatch',
      caseId
    };
  }

  const baselineFingerprint =
    clean(failedRedTeamOutcome.result?.requestFingerprint);
  const retestFingerprint =
    clean(retestRedTeamOutcome.result?.requestFingerprint);

  if (
    !/^[a-f0-9]{64}$/i.test(baselineFingerprint) ||
    baselineFingerprint !== retestFingerprint
  ) {
    return {
      type: 'authoritative_redteam_retest',
      available: false,
      reason: 'redteam_exact_retest_fingerprint_mismatch',
      caseId
    };
  }

  const binding =
    getAssessmentControlBinding(questionId);

  if (
    !binding?.available ||
    binding.controlId !== failedRedTeamEvidence.controlId
  ) {
    return {
      type: 'authoritative_redteam_retest',
      available: false,
      reason: 'assessment_control_binding_mismatch',
      caseId,
      questionId
    };
  }

  const before =
    await getControlIntelligenceControl({
      projectId,
      controlId: binding.controlId,
      userId
    });

  if (
    before.systemSnapshot?.id !==
    assessmentContext.systemSnapshotId
  ) {
    return {
      type: 'authoritative_redteam_retest',
      available: false,
      reason: 'current_snapshot_binding_mismatch',
      caseId,
      controlId: binding.controlId
    };
  }

  const finding =
    (before.findings || []).find(
      (item) => item.id === findingId
    );

  if (!finding) {
    return {
      type: 'authoritative_redteam_retest',
      available: false,
      reason: 'control_finding_not_found',
      findingId,
      controlId: binding.controlId
    };
  }

  if (
    ['verified_closed', 'accepted_risk'].includes(
      finding.status
    )
  ) {
    return {
      type: 'authoritative_redteam_retest',
      available: false,
      reason: 'control_finding_already_closed',
      findingId,
      controlId: binding.controlId
    };
  }

  const original =
    [
      ...(before.testHistory || []),
      ...(before.tests || [])
    ].find(
      (item) =>
        item.id === failedRedTeamEvidence.testExecutionId &&
        item.result === 'failed' &&
        item.executionKind !== 'retest'
    );

  if (!original) {
    return {
      type: 'authoritative_redteam_retest',
      available: false,
      reason: 'original_failed_test_execution_not_found',
      findingId,
      controlId: binding.controlId
    };
  }

  const retest =
    await recordControlTestExecution({
      projectId,
      controlId: binding.controlId,
      userId,
      input: {
        systemSnapshotId:
          assessmentContext.systemSnapshotId,
        result: 'passed',
        executionKind: 'retest',
        retestOfExecutionId:
          failedRedTeamEvidence.testExecutionId,
        findingId,
        remediationId: findingId,
        executionMethod:
          'bounded_redteam_exact_retest',
        inputReference:
          `${caseId}:${retestFingerprint}`,
        expectedResult:
          'The exact bounded adversarial case is denied before unauthorised execution or side effect.',
        observedResult:
          'The exact bounded adversarial case passed against the remediated snapshot within the authorised test scope.',
        limitations:
          retestRedTeamOutcome.trustBoundary ||
          'Customer-operated exact Red Team retest. Passing this case does not prove unrelated controls or production equivalence.'
      }
    });

  const evidence =
    await recordControlEvidence({
      projectId,
      controlId: binding.controlId,
      userId,
      input: {
        systemSnapshotId:
          assessmentContext.systemSnapshotId,
        testExecutionId: retest.id,
        findingId,
        remediationId: findingId,
        redteamRunId:
          retestRedTeamOutcome.runId,
        redteamBaselineRunId:
          failedRedTeamOutcome.runId,
        redteamCaseId: caseId,
        confirmAssessmentBinding: true,
        confirmSnapshotBinding: true,
        confirmTrustBoundary: true,
        limitations:
          'Closure evidence is limited to the same exact bounded Red Team request fingerprint, assessment, authorised target, control and remediated system snapshot.'
      }
    });

  const afterEvidence =
    await getControlIntelligenceControl({
      projectId,
      controlId: binding.controlId,
      userId
    });

  const currentFinding =
    (afterEvidence.findings || []).find(
      (item) => item.id === findingId
    );

  if (!currentFinding?.updatedAt) {
    return {
      type: 'authoritative_redteam_retest',
      available: false,
      reason: 'finding_revision_required_for_closure',
      findingId,
      controlId: binding.controlId,
      testExecutionId: retest.id,
      evidenceId: evidence.id
    };
  }

  const closed =
    await closeControlFinding({
      projectId,
      controlId: binding.controlId,
      findingId,
      userId,
      input: {
        systemSnapshotId:
          assessmentContext.systemSnapshotId,
        expectedUpdatedAt:
          currentFinding.updatedAt,
        limitations:
          'Verified closed only for the exact bounded Red Team case and remediated snapshot. This does not constitute a deployment approval or prove unrelated controls.'
      }
    });

  return {
    type: 'authoritative_redteam_retest',
    available: true,
    caseId,
    questionId,
    controlId: binding.controlId,
    findingId,
    originalTestExecutionId:
      failedRedTeamEvidence.testExecutionId,
    retestExecutionId: retest.id,
    evidenceId: evidence.id,
    verificationState:
      evidence.verificationState,
    verificationScope:
      evidence.verificationScope || null,
    redteamBaselineRunId:
      failedRedTeamOutcome.runId,
    redteamRetestRunId:
      retestRedTeamOutcome.runId,
    requestFingerprint: retestFingerprint,
    findingStatus: closed.status,
    deploymentApproved: false
  };
}
