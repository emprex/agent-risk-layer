import {
  inspectFrozenRepository
} from './tools/inspect-frozen-repository.mjs';

import {
  prepareAuthoritativeAssessmentWorkflow
} from './tools/prepare-authoritative-assessment-workflow.mjs';

import {
  resolvePersistedRedTeamContinuation
} from './tools/resolve-persisted-redteam-continuation.mjs';

import {
  resolvePersistedExactRetestContinuation
} from './tools/resolve-persisted-exact-retest-continuation.mjs';

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
  advanceAuthoritativeAssessmentWorkflow
} from './authoritative-assessment-workflow.mjs';

async function authoritativePreparation({
  repositoryPath,
  projectId,
  userId,
  assessmentId,
  preparation: suppliedPreparation = null
}) {
  const preparation =
    suppliedPreparation ||
    await prepareAuthoritativeAssessmentWorkflow({
      repositoryPath,
      projectId,
      userId,
      assessmentId
    });

  if (
    preparation?.assessmentWorkflow?.canContinue !== true ||
    preparation?.evidencePlan?.available !== true
  ) {
    return {
      available: false,
      reason:
        preparation?.assessmentWorkflow?.reason ||
        preparation?.evidencePlan?.reason ||
        'authoritative_assessment_workflow_not_ready',
      preparation
    };
  }

  return {
    available: true,
    preparation
  };
}

async function persistedRedTeamContinuation({
  action,
  repositoryPath,
  projectId,
  userId,
  assessmentId,
  preparation = null
}) {
  const prepared =
    await authoritativePreparation({
      repositoryPath,
      projectId,
      userId,
      assessmentId,
      preparation
    });

  if (!prepared.available) {
    return {
      available: false,
      reason: prepared.reason
    };
  }

  const { preparation: resolvedPreparation } = prepared;

  const continuation =
    await resolvePersistedRedTeamContinuation({
      projectId,
      userId,
      assessmentId,
      evidencePlan: resolvedPreparation.evidencePlan,
      caseId: action.caseId,
      controlId: action.controlId
    });

  if (!continuation.available) {
    return {
      available: false,
      reason: continuation.reason,
      preparation: resolvedPreparation
    };
  }

  return {
    available: true,
    preparation: resolvedPreparation,
    continuation
  };
}

async function recordPersistedRedTeamEvidence({
  action,
  repositoryPath,
  projectId,
  userId,
  assessmentId,
  preparation = null
}) {
  const resolved =
    await persistedRedTeamContinuation({
      action,
      repositoryPath,
      projectId,
      userId,
      assessmentId,
      preparation
    });

  if (!resolved.available) {
    return {
      executed: false,
      reason: resolved.reason
    };
  }

  const { preparation: resolvedPreparation, continuation } = resolved;

  if (continuation.persisted === true) {
    return {
      executed: true,
      effect: 'authoritative_redteam_evidence_already_recorded',
      selectionBasis: continuation.selectionBasis,
      securityStateChanged: false
    };
  }

  const outcome =
    await getAuthoritativeRedTeamOutcome({
      runId: continuation.runId,
      userId,
      assessmentId,
      evidencePlan: resolvedPreparation.evidencePlan,
      caseId: continuation.caseId
    });

  if (!outcome.available) {
    return {
      executed: false,
      reason:
        outcome.reason ||
        'authoritative_redteam_outcome_required'
    };
  }

  const evidence =
    await recordAuthoritativeRedTeamEvidence({
      projectId,
      userId,
      assessmentContext:
        resolvedPreparation.assessmentContext,
      assessmentWorkflow:
        resolvedPreparation.assessmentWorkflow,
      evidencePlan:
        resolvedPreparation.evidencePlan,
      redTeamOutcome: outcome
    });

  if (!evidence.available) {
    return {
      executed: false,
      reason:
        evidence.reason ||
        'authoritative_redteam_evidence_recording_failed'
    };
  }

  return {
    executed: true,
    effect: 'authoritative_redteam_evidence_recorded',
    selectionBasis: continuation.selectionBasis,
    securityStateChanged: true
  };
}

async function createPersistedRedTeamFinding({
  action,
  repositoryPath,
  projectId,
  userId,
  assessmentId,
  preparation = null
}) {
  const resolved =
    await persistedRedTeamContinuation({
      action,
      repositoryPath,
      projectId,
      userId,
      assessmentId,
      preparation
    });

  if (!resolved.available) {
    return {
      executed: false,
      reason: resolved.reason
    };
  }

  const { preparation: resolvedPreparation, continuation } = resolved;

  const lineage =
    await getAuthoritativeRedTeamLineage({
      projectId,
      userId,
      assessmentId,
      evidencePlan: resolvedPreparation.evidencePlan,
      runId: continuation.runId,
      caseId: continuation.caseId
    });

  if (!lineage.available) {
    return {
      executed: false,
      reason:
        lineage.reason ||
        'authoritative_redteam_lineage_required'
    };
  }

  if (lineage.findingId) {
    return {
      executed: true,
      effect: 'finding_open',
      selectionBasis: continuation.selectionBasis,
      securityStateChanged: false
    };
  }

  const finding =
    await createAuthoritativeRedTeamFinding({
      projectId,
      userId,
      assessmentContext:
        resolvedPreparation.assessmentContext,
      redTeamEvidence:
        lineage.redTeamEvidence
    });

  if (!finding.available) {
    return {
      executed: false,
      reason:
        finding.reason ||
        'authoritative_redteam_finding_creation_failed'
    };
  }

  return {
    executed: true,
    effect: 'finding_open',
    selectionBasis: continuation.selectionBasis,
    securityStateChanged: true
  };
}

async function completePersistedExactRetest({
  action,
  repositoryPath,
  projectId,
  userId,
  assessmentId,
  preparation = null
}) {
  const prepared =
    await authoritativePreparation({
      repositoryPath,
      projectId,
      userId,
      assessmentId,
      preparation
    });

  if (!prepared.available) {
    return {
      executed: false,
      reason: prepared.reason
    };
  }

  const { preparation: resolvedPreparation } = prepared;

  const continuation =
    await resolvePersistedExactRetestContinuation({
      projectId,
      userId,
      assessmentId,
      evidencePlan: resolvedPreparation.evidencePlan,
      caseId: action.caseId,
      controlId: action.controlId
    });

  if (!continuation.available) {
    return {
      executed: false,
      reason: continuation.reason
    };
  }

  const advanced =
    await advanceAuthoritativeAssessmentWorkflow({
      projectId,
      userId,
      assessmentId,
      assessmentContext:
        resolvedPreparation.assessmentContext,
      assessmentWorkflow:
        resolvedPreparation.assessmentWorkflow,
      evidencePlan:
        resolvedPreparation.evidencePlan,
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
    !advanced.available ||
    advanced.stage !== 'finding_verified_closed'
  ) {
    return {
      executed: false,
      reason:
        advanced.reason ||
        'authoritative_exact_retest_completion_failed'
    };
  }

  return {
    executed: true,
    effect: 'finding_verified_closed',
    selectionBasis:
      continuation.selectionBasis,
    securityStateChanged:
      advanced.alreadyCompleted !== true
  };
}

export async function executeAuthoritativeArlAction({
  action,
  repositoryPath,
  projectId = null,
  userId = null,
  assessmentId = null,
  preparation = null
} = {}) {
  if (!action?.name) {
    return {
      executed: false,
      reason: 'authoritative_action_required'
    };
  }

  if (action.actor !== 'arl' || action.requiresUserInput === true) {
    return {
      executed: false,
      reason: 'automatic_action_gate_not_satisfied'
    };
  }

  if (action.name === 'build_authoritative_evidence_plan') {
    const preparation =
      await prepareAuthoritativeAssessmentWorkflow({
        repositoryPath,
        projectId,
        userId,
        assessmentId
      });

    if (preparation?.evidencePlan?.available !== true) {
      return {
        executed: false,
        reason:
          preparation?.evidencePlan?.reason ||
          'authoritative_evidence_plan_not_available'
      };
    }

    return {
      executed: true,
      effect: 'authoritative_evidence_plan_derived',
      securityStateChanged: false
    };
  }

  if (action.name === 'run_frozen_source_inspection') {
    const frozen =
      await inspectFrozenRepository(repositoryPath);

    if (
      frozen?.binding?.verified !== true ||
      !frozen?.target?.revision
    ) {
      return {
        executed: false,
        reason: 'frozen_source_inspection_not_authoritative'
      };
    }

    return {
      executed: true,
      effect: 'frozen_source_inspection_completed',
      securityStateChanged: false
    };
  }

  if (action.name === 'record_authoritative_evidence') {
    return recordPersistedRedTeamEvidence({
      action,
      repositoryPath,
      projectId,
      userId,
      assessmentId,
      preparation
    });
  }

  if (action.name === 'create_authoritative_finding') {
    return createPersistedRedTeamFinding({
      action,
      repositoryPath,
      projectId,
      userId,
      assessmentId,
      preparation
    });
  }

  if (action.name === 'complete_authoritative_retest') {
    return completePersistedExactRetest({
      action,
      repositoryPath,
      projectId,
      userId,
      assessmentId,
      preparation
    });
  }

  return {
    executed: false,
    reason: 'unsupported_automatic_arl_action'
  };
}