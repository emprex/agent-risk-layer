import {
  listRedTeamRunsForAssessment
} from '../../redteam.js';

import {
  getAuthoritativeRedTeamOutcome
} from './get-authoritative-redteam-outcome.mjs';

import {
  getAuthoritativeRedTeamLineage
} from './get-authoritative-redteam-lineage.mjs';

const EXPECTED_ABSENCE_REASON =
  'redteam_control_evidence_not_recorded';

const INTEGRITY_FAILURE_REASONS = new Set([
  'redteam_control_evidence_ambiguous',
  'redteam_test_execution_not_found',
  'redteam_test_execution_outcome_mismatch'
]);

function unavailable(reason, extra = {}) {
  return {
    type: 'persisted_redteam_continuation',
    available: false,
    reason,
    ...extra
  };
}

function candidateProjection(candidate) {
  return {
    runId: candidate.runId,
    caseId: candidate.caseId,
    controlId: candidate.controlId,
    persisted: candidate.persisted,
    createdAt: candidate.createdAt || null
  };
}

export function selectPersistedRedTeamContinuation(
  candidates = []
) {
  const unresolved =
    candidates.filter(
      (candidate) => candidate.persisted === false
    );

  if (unresolved.length > 1) {
    return unavailable(
      'persisted_redteam_continuation_ambiguous',
      {
        candidateCount: unresolved.length,
        candidates:
          unresolved.map(candidateProjection)
      }
    );
  }

  if (unresolved.length === 1) {
    return {
      type: 'persisted_redteam_continuation',
      available: true,
      selectionBasis:
        'unique_unrecorded_authoritative_run',
      ...candidateProjection(unresolved[0])
    };
  }

  const persisted =
    candidates.filter(
      (candidate) => candidate.persisted === true
    );

  if (persisted.length > 1) {
    return unavailable(
      'persisted_redteam_lineage_ambiguous',
      {
        candidateCount: persisted.length,
        candidates:
          persisted.map(candidateProjection)
      }
    );
  }

  if (persisted.length === 1) {
    return {
      type: 'persisted_redteam_continuation',
      available: true,
      selectionBasis:
        'unique_persisted_authoritative_lineage',
      ...candidateProjection(persisted[0])
    };
  }

  return unavailable(
    'persisted_redteam_continuation_not_found'
  );
}

export async function resolvePersistedRedTeamContinuation({
  projectId,
  userId,
  assessmentId,
  evidencePlan,
  caseId,
  controlId = null
} = {}) {
  if (!projectId || !userId || !assessmentId) {
    return unavailable(
      'authoritative_assessment_identity_required'
    );
  }

  if (!evidencePlan?.available) {
    return unavailable(
      evidencePlan?.reason ||
      'authoritative_evidence_plan_required'
    );
  }

  if (!caseId) {
    return unavailable(
      'authoritative_redteam_case_required'
    );
  }

  let runs;

  try {
    runs = await listRedTeamRunsForAssessment({
      assessmentId,
      userId
    });
  } catch (error) {
    return unavailable(
      'persisted_redteam_runs_unavailable',
      {
        detail: error?.message || null
      }
    );
  }

  const candidates = [];

  for (const run of runs) {
    const outcome =
      await getAuthoritativeRedTeamOutcome({
        runId: run.id,
        userId,
        assessmentId,
        evidencePlan,
        caseId
      });

    /*
     * A run that does not satisfy the authoritative Evidence Plan, target
     * evidence boundary, assessment binding or case result contract is not a
     * continuation candidate. Nothing is inferred from timestamps or labels.
     */
    if (!outcome.available) {
      continue;
    }

    const lineage =
      await getAuthoritativeRedTeamLineage({
        projectId,
        userId,
        assessmentId,
        evidencePlan,
        runId: run.id,
        caseId
      });

    if (
      lineage.available !== true &&
      INTEGRITY_FAILURE_REASONS.has(lineage.reason)
    ) {
      return unavailable(
        lineage.reason,
        {
          runId: run.id,
          caseId,
          controlId:
            lineage.controlId || null
        }
      );
    }

    if (
      lineage.available !== true &&
      lineage.reason !== EXPECTED_ABSENCE_REASON
    ) {
      continue;
    }

    const resolvedControlId =
      lineage.controlId || null;

    if (
      controlId &&
      resolvedControlId !== controlId
    ) {
      continue;
    }

    candidates.push({
      runId: run.id,
      caseId,
      controlId: resolvedControlId,
      persisted: lineage.available === true,
      createdAt: run.createdAt || null
    });
  }

  return selectPersistedRedTeamContinuation(
    candidates
  );
}
