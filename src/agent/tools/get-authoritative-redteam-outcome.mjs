import {
  getRedTeamRun
} from '../../redteam.js';

import {
  getAuthoritativeRedTeamCase
} from './get-authoritative-redteam-case.mjs';

export async function getAuthoritativeRedTeamOutcome({
  runId,
  userId,
  assessmentId = null,
  evidencePlan,
  caseId
} = {}) {
  if (!runId || !userId) {
    return {
      type: 'authoritative_redteam_outcome',
      available: false,
      reason: 'redteam_run_identity_required'
    };
  }

  const planned =
    getAuthoritativeRedTeamCase({
      evidencePlan,
      caseId
    });

  if (!planned.available) {
    return {
      type: 'authoritative_redteam_outcome',
      available: false,
      reason: planned.reason,
      caseId: caseId || null
    };
  }

  const run =
    await getRedTeamRun({
      runId,
      userId
    });

  if (!run) {
    return {
      type: 'authoritative_redteam_outcome',
      available: false,
      reason: 'redteam_run_not_found',
      runId
    };
  }

  if (
    assessmentId &&
    run.assessmentId !== assessmentId
  ) {
    return {
      type: 'authoritative_redteam_outcome',
      available: false,
      reason: 'redteam_assessment_binding_mismatch',
      runId,
      assessmentId,
      runAssessmentId: run.assessmentId || null
    };
  }

  if (
    run.signatureValid !== true ||
    run.trust?.signatureValid !== true
  ) {
    return {
      type: 'authoritative_redteam_outcome',
      available: false,
      reason: 'redteam_integrity_verification_required',
      runId,
      caseId
    };
  }

  if (
    run.trust?.targetEvidence !== true ||
    run.campaign?.target?.mode !== 'staging-adapter'
  ) {
    return {
      type: 'authoritative_redteam_outcome',
      available: false,
      reason: 'redteam_target_evidence_required',
      runId,
      caseId,
      evidenceClass: run.trust?.evidenceClass || null
    };
  }

  const results =
    Array.isArray(run.results)
      ? run.results
      : [];

  const matches =
    results.filter(
      (item) =>
        item?.caseId === caseId
    );

  if (matches.length !== 1) {
    return {
      type: 'authoritative_redteam_outcome',
      available: false,
      reason:
        matches.length === 0
          ? 'planned_case_not_present_in_run'
          : 'planned_case_result_ambiguous',
      runId,
      caseId
    };
  }

  const result =
    matches[0];

  const status =
    result.outcome === 'passed'
      ? 'passed'
      : result.outcome === 'failed'
        ? 'failed'
        : 'unresolved';

  if (status === 'unresolved') {
    return {
      type: 'authoritative_redteam_outcome',
      available: false,
      reason: 'redteam_case_outcome_unresolved',
      runId,
      caseId,
      outcome: result.outcome || null
    };
  }

  return {
    type: 'authoritative_redteam_outcome',
    available: true,

    runId,
    assessmentId: run.assessmentId || null,
    caseId,

    questionId:
      planned.questionId,

    evidencePlanCheckId:
      planned.evidencePlanCheckId,

    status,
    result,

    runSummary:
      run.summary || null,

    signatureValid: true,

    bundleDigest:
      run.digest || null,

    evidenceClass:
      run.trust?.evidenceClass || null,

    trustBoundary:
      run.trust?.boundary || null,

    targetEvidence: true,

    authorisationId:
      run.authorisationId || null,

    campaign:
      run.campaign || null
  };
}
