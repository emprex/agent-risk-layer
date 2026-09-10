import {
  getDeploymentReadiness
} from './tools/get-deployment-readiness.mjs';

import {
  getAuthoritativeRedTeamOutcome
} from './tools/get-authoritative-redteam-outcome.mjs';

import {
  getAuthoritativeRedTeamLineage
} from './tools/get-authoritative-redteam-lineage.mjs';

import {
  recordAuthoritativeRedTeamEvidence
} from './tools/record-authoritative-redteam-evidence.mjs';

import {
  createAuthoritativeRedTeamFinding
} from './tools/create-authoritative-redteam-finding.mjs';

import {
  recordAuthoritativeRemediationImplementation
} from './tools/record-authoritative-remediation-implementation.mjs';

import {
  completeAuthoritativeRedTeamRetest
} from './tools/complete-authoritative-redteam-retest.mjs';

function unavailable(reason, extra = {}) {
  return {
    type: 'authoritative_assessment_workflow',
    available: false,
    reason,
    ...extra,
    deploymentDecisionWritten: false,
    humanReviewRequired: true
  };
}

async function readiness(projectId, userId) {
  return getDeploymentReadiness({
    projectId,
    userId
  });
}

async function persistedLineage({
  projectId,
  userId,
  assessmentId,
  evidencePlan,
  runId,
  caseId
}) {
  return getAuthoritativeRedTeamLineage({
    projectId,
    userId,
    assessmentId,
    evidencePlan,
    runId,
    caseId
  });
}

export async function advanceAuthoritativeAssessmentWorkflow({
  projectId,
  userId,
  assessmentId,
  assessmentContext,
  assessmentWorkflow,
  evidencePlan,
  redTeamRunId = null,
  redTeamCaseId = null,
  baselineRunId = null,
  retestRunId = null,
  findingId = null,
  implementationSourceType = 'asset_snapshot',
  implementationSourceId = null
} = {}) {
  if (!projectId || !userId || !assessmentId) {
    return unavailable('authoritative_project_assessment_identity_required');
  }

  if (
    !assessmentContext?.available ||
    !assessmentContext.systemSnapshotId
  ) {
    return unavailable('authoritative_assessment_context_required');
  }

  if (
    !assessmentWorkflow ||
    assessmentWorkflow.canContinue !== true
  ) {
    return unavailable(
      assessmentWorkflow?.reason || 'assessment_workflow_not_ready',
      {
        blockedAt:
          assessmentWorkflow?.blockedAt || null
      }
    );
  }

  if (!evidencePlan?.available) {
    return unavailable(
      evidencePlan?.reason || 'authoritative_evidence_plan_required'
    );
  }

  /*
   * Exact retest completion is the most specific continuation.
   * It resumes entirely from persisted baseline evidence plus the supplied
   * signed retest run. No in-memory object from the original process is
   * required.
   */
  if (baselineRunId && retestRunId && redTeamCaseId) {
    const baseline =
      await persistedLineage({
        projectId,
        userId,
        assessmentId,
        evidencePlan,
        runId: baselineRunId,
        caseId: redTeamCaseId
      });

    if (!baseline.available) {
      return unavailable(
        baseline.reason,
        {
          stage: 'retest',
          baselineRunId,
          retestRunId,
          caseId: redTeamCaseId
        }
      );
    }

    if (
      baseline.outcome?.status !== 'failed' ||
      baseline.redTeamEvidence?.result !== 'failed' ||
      !baseline.findingId
    ) {
      return unavailable(
        'persisted_failed_redteam_finding_lineage_required',
        {
          stage: 'retest',
          baselineRunId,
          caseId: redTeamCaseId
        }
      );
    }

    if (
      findingId &&
      findingId !== baseline.findingId
    ) {
      return unavailable(
        'finding_identity_lineage_mismatch',
        {
          stage: 'retest',
          expectedFindingId: baseline.findingId,
          suppliedFindingId: findingId
        }
      );
    }

    if (baseline.findingStatus === 'verified_closed') {
      return {
        type: 'authoritative_assessment_workflow',
        available: true,
        stage: 'finding_verified_closed',
        resumedFromPersistence: true,
        alreadyCompleted: true,
        caseId: redTeamCaseId,
        controlId: baseline.controlId,
        findingId: baseline.findingId,
        baselineRunId,
        retestRunId,
        readiness:
          await readiness(projectId, userId),
        deploymentDecisionWritten: false,
        humanReviewRequired: true
      };
    }

    const retestOutcome =
      await getAuthoritativeRedTeamOutcome({
        runId: retestRunId,
        userId,
        assessmentId,
        evidencePlan,
        caseId: redTeamCaseId
      });

    if (!retestOutcome.available) {
      return unavailable(
        retestOutcome.reason,
        {
          stage: 'retest',
          baselineRunId,
          retestRunId,
          caseId: redTeamCaseId
        }
      );
    }

    const completed =
      await completeAuthoritativeRedTeamRetest({
        projectId,
        userId,
        assessmentContext,
        evidencePlan,
        failedRedTeamOutcome:
          baseline.outcome,
        retestRedTeamOutcome:
          retestOutcome,
        failedRedTeamEvidence:
          baseline.redTeamEvidence,
        findingId:
          baseline.findingId
      });

    if (!completed.available) {
      return unavailable(
        completed.reason,
        {
          stage: 'retest',
          caseId: redTeamCaseId,
          findingId: baseline.findingId
        }
      );
    }

    return {
      type: 'authoritative_assessment_workflow',
      available: true,
      stage: 'finding_verified_closed',
      resumedFromPersistence: true,
      caseId: redTeamCaseId,
      controlId: completed.controlId,
      findingId: completed.findingId,
      baselineRunId,
      retestRunId,
      retest: completed,
      readiness:
        await readiness(projectId, userId),
      deploymentDecisionWritten: false,
      humanReviewRequired: true
    };
  }

  /*
   * Implementation evidence is accepted only for a persisted failed Red Team
   * finding. The workflow does not infer that a code change happened merely
   * because the caller supplies a finding id.
   */
  if (baselineRunId && redTeamCaseId && implementationSourceId) {
    const baseline =
      await persistedLineage({
        projectId,
        userId,
        assessmentId,
        evidencePlan,
        runId: baselineRunId,
        caseId: redTeamCaseId
      });

    if (!baseline.available) {
      return unavailable(
        baseline.reason,
        {
          stage: 'remediation',
          baselineRunId,
          caseId: redTeamCaseId
        }
      );
    }

    if (
      baseline.outcome?.status !== 'failed' ||
      !baseline.findingId
    ) {
      return unavailable(
        'persisted_failed_redteam_finding_lineage_required',
        {
          stage: 'remediation',
          baselineRunId,
          caseId: redTeamCaseId
        }
      );
    }

    if (
      findingId &&
      findingId !== baseline.findingId
    ) {
      return unavailable(
        'finding_identity_lineage_mismatch',
        {
          stage: 'remediation',
          expectedFindingId: baseline.findingId,
          suppliedFindingId: findingId
        }
      );
    }

    if (baseline.findingStatus !== 'open') {
      return {
        type: 'authoritative_assessment_workflow',
        available: true,
        stage:
          baseline.findingStatus === 'verified_closed'
            ? 'finding_verified_closed'
            : 'changed_system_snapshot_required',
        resumedFromPersistence: true,
        alreadyRecorded: true,
        caseId: redTeamCaseId,
        controlId: baseline.controlId,
        findingId: baseline.findingId,
        findingStatus: baseline.findingStatus,
        readiness:
          await readiness(projectId, userId),
        deploymentDecisionWritten: false,
        humanReviewRequired: true
      };
    }

    const implementation =
      await recordAuthoritativeRemediationImplementation({
        projectId,
        userId,
        findingId: baseline.findingId,
        sourceType: implementationSourceType,
        sourceId: implementationSourceId
      });

    if (!implementation.available) {
      return unavailable(
        implementation.reason,
        {
          stage: 'remediation',
          findingId: baseline.findingId
        }
      );
    }

    return {
      type: 'authoritative_assessment_workflow',
      available: true,
      stage: 'changed_system_snapshot_required',
      resumedFromPersistence: true,
      caseId: redTeamCaseId,
      controlId: baseline.controlId,
      findingId: baseline.findingId,
      implementation,
      readiness:
        await readiness(projectId, userId),
      deploymentDecisionWritten: false,
      humanReviewRequired: true
    };
  }

  /*
   * Process one bounded Red Team run selected by the authoritative Evidence
   * Plan. Before writing anything, check whether the exact run has already
   * been persisted into Control Intelligence so a repeated agent request is
   * idempotent.
   */
  if (redTeamRunId && redTeamCaseId) {
    const existing =
      await persistedLineage({
        projectId,
        userId,
        assessmentId,
        evidencePlan,
        runId: redTeamRunId,
        caseId: redTeamCaseId
      });

    if (existing.available) {
      if (
        existing.outcome?.status === 'failed' &&
        !existing.findingId
      ) {
        const finding =
          await createAuthoritativeRedTeamFinding({
            projectId,
            userId,
            assessmentContext,
            redTeamEvidence:
              existing.redTeamEvidence
          });

        if (!finding.available) {
          return unavailable(
            finding.reason,
            {
              stage: 'finding',
              runId: redTeamRunId,
              caseId: redTeamCaseId
            }
          );
        }

        return {
          type: 'authoritative_assessment_workflow',
          available: true,
          stage: 'finding_open',
          resumedFromPersistence: true,
          alreadyRecorded: true,
          runId: redTeamRunId,
          caseId: redTeamCaseId,
          controlId: finding.controlId,
          findingId: finding.findingId,
          readiness:
            await readiness(projectId, userId),
          deploymentDecisionWritten: false,
          humanReviewRequired: true
        };
      }

      return {
        type: 'authoritative_assessment_workflow',
        available: true,
        stage:
          existing.outcome?.status === 'failed'
            ? 'finding_open'
            : 'bounded_test_passed',
        resumedFromPersistence: true,
        alreadyRecorded: true,
        runId: redTeamRunId,
        caseId: redTeamCaseId,
        controlId: existing.controlId,
        findingId: existing.findingId,
        findingStatus: existing.findingStatus,
        readiness:
          await readiness(projectId, userId),
        deploymentDecisionWritten: false,
        humanReviewRequired: true
      };
    }

    if (
      existing.reason !==
      'redteam_control_evidence_not_recorded'
    ) {
      return unavailable(
        existing.reason,
        {
          stage: 'bounded_redteam',
          runId: redTeamRunId,
          caseId: redTeamCaseId
        }
      );
    }

    const outcome = existing.outcome;

    if (!outcome?.available) {
      return unavailable(
        outcome?.reason || 'authoritative_redteam_outcome_required',
        {
          stage: 'bounded_redteam',
          runId: redTeamRunId,
          caseId: redTeamCaseId
        }
      );
    }

    const evidence =
      await recordAuthoritativeRedTeamEvidence({
        projectId,
        userId,
        assessmentContext,
        assessmentWorkflow,
        evidencePlan,
        redTeamOutcome: outcome
      });

    if (!evidence.available) {
      return unavailable(
        evidence.reason,
        {
          stage: 'evidence',
          runId: redTeamRunId,
          caseId: redTeamCaseId
        }
      );
    }

    if (outcome.status === 'passed') {
      return {
        type: 'authoritative_assessment_workflow',
        available: true,
        stage: 'bounded_test_passed',
        resumedFromPersistence: false,
        runId: redTeamRunId,
        caseId: redTeamCaseId,
        controlId: evidence.controlId,
        evidence,
        findingId: null,
        readiness:
          await readiness(projectId, userId),
        deploymentDecisionWritten: false,
        humanReviewRequired: true
      };
    }

    const finding =
      await createAuthoritativeRedTeamFinding({
        projectId,
        userId,
        assessmentContext,
        redTeamEvidence: evidence
      });

    if (!finding.available) {
      return unavailable(
        finding.reason,
        {
          stage: 'finding',
          runId: redTeamRunId,
          caseId: redTeamCaseId,
          controlId: evidence.controlId
        }
      );
    }

    return {
      type: 'authoritative_assessment_workflow',
      available: true,
      stage: 'finding_open',
      resumedFromPersistence: false,
      runId: redTeamRunId,
      caseId: redTeamCaseId,
      controlId: evidence.controlId,
      evidence,
      finding,
      findingId: finding.findingId,
      readiness:
        await readiness(projectId, userId),
      deploymentDecisionWritten: false,
      humanReviewRequired: true
    };
  }

  return {
    type: 'authoritative_assessment_workflow',
    available: true,
    stage: 'evidence_plan_ready',
    evidencePlan,
    nextAction:
      'Collect only the evidence requested by the authoritative Evidence Plan. Run bounded Red Team cases only under the existing Rules of Engagement workflow.',
    readiness:
      await readiness(projectId, userId),
    deploymentDecisionWritten: false,
    humanReviewRequired: true
  };
}
