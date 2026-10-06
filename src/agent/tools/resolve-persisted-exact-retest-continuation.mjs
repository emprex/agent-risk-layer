import {
  listRedTeamRunsForAssessment,
  verifyExactRetestAuthorisationLineage
} from '../../redteam.js';

import {
  getAuthoritativeRedTeamOutcome
} from './get-authoritative-redteam-outcome.mjs';

import {
  getAuthoritativeRedTeamLineage
} from './get-authoritative-redteam-lineage.mjs';

const EVIDENCE_NOT_RECORDED =
  'redteam_control_evidence_not_recorded';

function unavailable(reason, extra = {}) {
  return {
    type: 'persisted_exact_retest_continuation',
    available: false,
    reason,
    ...extra
  };
}

function clean(value) {
  return String(value ?? '').trim();
}

function baselineSemanticKey(candidate) {
  return JSON.stringify({
    controlId:
      candidate.lineage?.controlId || null,
    findingId:
      candidate.lineage?.findingId || null,
    caseId:
      candidate.outcome?.caseId || null,
    requestFingerprint:
      clean(candidate.outcome?.result?.requestFingerprint),
    targetIdentity:
      targetIdentity(candidate.outcome)
  });
}

function collapseEquivalentBaselines(items = []) {
  const groups = new Map();

  for (const item of items) {
    const key = baselineSemanticKey(item);
    const group = groups.get(key) || [];
    group.push(item);
    groups.set(key, group);
  }

  if (groups.size !== 1) {
    return {
      available: false,
      candidates: items
    };
  }

  const equivalent = [...groups.values()][0]
    .slice()
    .sort((left, right) => {
      const timeOrder =
        String(left.createdAt || '')
          .localeCompare(String(right.createdAt || ''));

      if (timeOrder !== 0) return timeOrder;

      return String(left.runId || '')
        .localeCompare(String(right.runId || ''));
    });

  return {
    available: true,
    baseline: equivalent[0],
    equivalentRunIds:
      equivalent.map((item) => item.runId)
  };
}

function targetIdentity(outcome) {
  const campaign = outcome?.campaign || {};
  const target = campaign.target || {};

  return JSON.stringify({
    mode: clean(target.mode),
    environment: clean(campaign.environment),
    endpointOrigin: clean(target.endpointOrigin),
    endpointPathHash: clean(target.endpointPathHash),
    profile:
      target.profile == null
        ? ''
        : clean(target.profile)
  });
}

function exactPair(baseline, retest) {
  const baselineFingerprint =
    clean(baseline.outcome?.result?.requestFingerprint);
  const retestFingerprint =
    clean(retest.outcome?.result?.requestFingerprint);

  if (
    !/^[a-f0-9]{64}$/i.test(baselineFingerprint) ||
    baselineFingerprint !== retestFingerprint
  ) {
    return false;
  }

  if (!baseline.outcome?.authorisationId) {
    return false;
  }

  if (
    baseline.outcome.authorisationId !==
      retest.outcome?.authorisationId &&
    retest.authorisationLineageVerified !== true
  ) {
    return false;
  }

  if (
    targetIdentity(baseline.outcome) !==
    targetIdentity(retest.outcome)
  ) {
    return false;
  }

  const baselineTime = Date.parse(
    baseline.createdAt || ''
  );
  const retestTime = Date.parse(
    retest.createdAt || ''
  );

  return (
    Number.isFinite(baselineTime) &&
    Number.isFinite(retestTime) &&
    retestTime > baselineTime
  );
}

export function selectPersistedExactRetestContinuation({
  baselines = [],
  retests = [],
  caseId = null,
  requiredRetestRevision = null
} = {}) {
  if (baselines.length === 0) {
    return unavailable(
      'persisted_failed_redteam_baseline_not_found'
    );
  }

  let baseline;
  let equivalentBaselineRunIds = [];

  if (baselines.length === 1) {
    baseline = baselines[0];
    equivalentBaselineRunIds = [baseline.runId];
  } else {
    const collapsed =
      collapseEquivalentBaselines(baselines);

    if (!collapsed.available) {
      return unavailable(
        'persisted_failed_redteam_baseline_ambiguous',
        {
          candidateCount: baselines.length
        }
      );
    }

    baseline = collapsed.baseline;
    equivalentBaselineRunIds =
      collapsed.equivalentRunIds;
  }
  const requiredRevision =
    clean(requiredRetestRevision).toLowerCase();

  const exactRetests =
    retests.filter((candidate) => {
      if (!exactPair(baseline, candidate)) {
        return false;
      }

      if (!requiredRevision) {
        return true;
      }

      const retestRevision =
        clean(
          candidate.outcome?.campaign?.target?.revision
        ).toLowerCase();

      return (
        /^[a-f0-9]{40}$/.test(retestRevision) &&
        retestRevision === requiredRevision
      );
    });

  if (exactRetests.length === 0) {
    return unavailable(
      'persisted_exact_retest_not_found'
    );
  }

  if (exactRetests.length !== 1) {
    return unavailable(
      'persisted_exact_retest_ambiguous',
      {
        candidateCount: exactRetests.length
      }
    );
  }

  const retest = exactRetests[0];

  return {
    type: 'persisted_exact_retest_continuation',
    available: true,
    selectionBasis:
      'unique_exact_authorised_retest_lineage',
    baselineRunId: baseline.runId,
    equivalentBaselineRunIds,
    retestRunId: retest.runId,
    caseId,
    controlId:
      baseline.lineage?.controlId || null,
    findingId:
      baseline.lineage?.findingId || null,
    findingStatus:
      baseline.lineage?.findingStatus || null,
    originalTestExecutionId:
      baseline.lineage?.redTeamEvidence?.testExecutionId || null,
    retestStatus:
      retest.outcome?.status || null,
    requestFingerprint:
      retest.outcome?.result?.requestFingerprint || null
  };
}

export async function resolvePersistedExactRetestContinuation({
  projectId,
  userId,
  assessmentId,
  evidencePlan,
  caseId,
  controlId = null,
  requiredRetestRevision = null
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

  const baselines = [];
  const retests = [];

  for (const run of runs) {
    const outcome =
      await getAuthoritativeRedTeamOutcome({
        runId: run.id,
        userId,
        assessmentId,
        evidencePlan,
        caseId
      });

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

    const lineageControlId =
      lineage.controlId || null;

    if (
      controlId &&
      lineageControlId &&
      lineageControlId !== controlId
    ) {
      continue;
    }

    if (
      outcome.status === 'failed' &&
      lineage.available === true &&
      lineage.redTeamEvidence?.executionKind === 'initial' &&
      lineage.findingId &&
      !['verified_closed', 'accepted_risk'].includes(
        lineage.findingStatus
      )
    ) {
      baselines.push({
        runId: run.id,
        createdAt: run.createdAt || null,
        outcome,
        lineage
      });
      continue;
    }

    if (
      ['passed', 'failed'].includes(outcome.status) &&
      lineage.available !== true &&
      lineage.reason === EVIDENCE_NOT_RECORDED
    ) {
      retests.push({
        runId: run.id,
        createdAt: run.createdAt || null,
        outcome,
        lineage
      });
    }
  }

  if (baselines.length === 1) {
    const baseline = baselines[0];

    for (const retest of retests) {
      if (
        baseline.outcome?.authorisationId &&
        retest.outcome?.authorisationId &&
        baseline.outcome.authorisationId !==
          retest.outcome.authorisationId
      ) {
        const lineage =
          await verifyExactRetestAuthorisationLineage({
            userId,
            assessmentId,
            baselineAuthorisationId:
              baseline.outcome.authorisationId,
            retestAuthorisationId:
              retest.outcome.authorisationId
          });

        retest.authorisationLineageVerified =
          lineage.available === true;
      }
    }
  }

  return selectPersistedExactRetestContinuation({
    baselines,
    retests,
    caseId,
    requiredRetestRevision
  });
}
