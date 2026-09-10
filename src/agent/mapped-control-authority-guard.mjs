import {
  getControlIntelligenceControl
} from '../control-intelligence.js';

export const MAPPED_CONTROL_AUTHORITY_GUARD_SCHEMA =
  'arl.agent.mapped-control-authority-guard.v1';

const WORKFLOW_STATE_SCHEMA =
  'arl.agent.workflow-state.v1';

function mappedControls(workflowState) {
  const mapped =
    workflowState?.authoritativeArtifacts
      ?.evidencePlan?.mappedControls;

  if (!Array.isArray(mapped)) {
    return [];
  }

  const byControl = new Map();

  for (const item of mapped) {
    if (!item?.controlId) {
      continue;
    }

    if (!byControl.has(item.controlId)) {
      byControl.set(item.controlId, item);
    }
  }

  return [...byControl.values()];
}

function projectionItem(detail) {
  return {
    controlId: detail.control?.id || null,
    currentStage: detail.chain?.currentStage || null,
    chainStatus: detail.chain?.chainStatus || null,
    nextAction: detail.chain?.nextAction || null,
    deploymentImpact:
      detail.chain?.deploymentImpact || null,
    availableActions:
      Array.isArray(detail.chain?.availableActions)
        ? detail.chain.availableActions
        : [],
    authorityProjection: true
  };
}

function withExactRelevantControls(
  workflowState,
  exactControls
) {
  const artifacts =
    workflowState.authoritativeArtifacts || {};
  const intelligence =
    artifacts.controlIntelligence || {};
  const mappedIds = new Set(
    exactControls
      .map((item) => item.controlId)
      .filter(Boolean)
  );
  const existing =
    Array.isArray(intelligence.relevantControls)
      ? intelligence.relevantControls
      : [];

  return {
    ...workflowState,
    authoritativeArtifacts: {
      ...artifacts,
      controlIntelligence: {
        ...intelligence,
        relevantControls: [
          ...existing.filter(
            (item) => !mappedIds.has(item?.controlId)
          ),
          ...exactControls
        ]
      }
    }
  };
}

function maskReadiness(workflowState, reason) {
  const snapshotId =
    workflowState?.authoritativeArtifacts
      ?.assessmentContext?.systemSnapshotId ||
    workflowState?.readiness?.systemSnapshotId ||
    null;

  const readiness = {
    available: false,
    decision: null,
    systemSnapshotId: snapshotId,
    reason,
    humanReviewRequired: true
  };

  return {
    ...workflowState,
    readiness,
    authoritativeArtifacts: {
      ...(workflowState.authoritativeArtifacts || {}),
      readiness
    }
  };
}

function guardMetadata(extra = {}) {
  return {
    schema: MAPPED_CONTROL_AUTHORITY_GUARD_SCHEMA,
    applied: true,
    source: 'control_intelligence_detail',
    paginationBypass: true,
    failClosed: true,
    ...extra
  };
}

function applicabilityState({
  workflowState,
  selected,
  mapping,
  exactControls
}) {
  let next = withExactRelevantControls(
    workflowState,
    exactControls
  );

  next = maskReadiness(
    next,
    'mapped_control_applicability_required'
  );

  return {
    ...next,
    stage: 'control_applicability_required',
    blocked: true,
    canAutoAdvance: false,
    blockers: [
      {
        code:
          'guided_customer_applicability_review_required',
        source: 'control_intelligence_detail',
        userActionRequired: true
      }
    ],
    scopedControl: {
      controlId: selected.controlId,
      currentStage: 'applicability',
      chainStatus:
        selected.chainStatus || 'context_required',
      nextAction:
        selected.nextAction ||
        'Provide missing architecture information and confirm applicability.',
      deploymentImpact:
        selected.deploymentImpact || 'hold'
    },
    nextAllowedAction: {
      name: 'resolve_control_applicability',
      actor: 'user',
      requiresUserInput: true,
      reason:
        'The exact Control Intelligence detail for the Evidence Plan control requires an explicit guided customer applicability review before bounded testing can continue.',
      controlId: selected.controlId,
      caseId: mapping?.caseId || null
    },
    mappedControlAuthorityGuard:
      guardMetadata()
  };
}

function readinessReviewState({
  workflowState,
  selected,
  mapping,
  exactControls,
  supersededStage = null
}) {
  const next = withExactRelevantControls(
    workflowState,
    exactControls
  );

  return {
    ...next,
    stage: 'readiness_review',
    blocked: true,
    canAutoAdvance: false,
    blockers: [
      {
        code: 'human_final_decision_required',
        source: 'human_accountability',
        userActionRequired: true
      }
    ],
    scopedControl: selected
      ? {
          controlId: selected.controlId,
          currentStage: 'deployment_decision',
          chainStatus: selected.chainStatus || null,
          nextAction:
            selected.nextAction ||
            'Review the project deployment decision.',
          deploymentImpact:
            selected.deploymentImpact || null
        }
      : null,
    nextAllowedAction: {
      name: 'review_current_arl_readiness',
      actor: 'human',
      requiresUserInput: true,
      reason:
        'The exact mapped Control Intelligence journey has reached deployment review. ARL may present readiness but cannot make the final deployment decision.',
      controlId: selected?.controlId || null,
      caseId: mapping?.caseId || null
    },
    mappedControlAuthorityGuard:
      guardMetadata({
        projectedReadinessReview: true,
        ...(supersededStage
          ? { supersededStaleStage: supersededStage }
          : {})
      })
  };
}

function conflictState({
  workflowState,
  exactControls,
  reason,
  candidateCount = 0
}) {
  let next = withExactRelevantControls(
    workflowState,
    exactControls
  );

  next = maskReadiness(next, reason);

  return {
    ...next,
    stage: 'persisted_lineage_resolution_required',
    blocked: true,
    canAutoAdvance: false,
    blockers: [
      {
        code: reason,
        source: 'control_intelligence_detail',
        userActionRequired: true
      }
    ],
    scopedControl: null,
    nextAllowedAction: {
      name: 'review_persisted_lineage_ambiguity',
      actor: 'human',
      requiresUserInput: true,
      reason:
        'The paginated workflow fallback conflicts with the exact mapped Control Intelligence journey. ARL will not guess which authoritative stage may continue.',
      controlId: null,
      caseId: null
    },
    mappedControlAuthorityGuard:
      guardMetadata({
        ambiguity: true,
        reason,
        candidateCount
      })
  };
}

export async function applyMappedControlAuthorityGuard({
  workflowState,
  projectId,
  userId
} = {}) {
  if (
    !workflowState ||
    workflowState.schema !== WORKFLOW_STATE_SCHEMA ||
    workflowState.available !== true ||
    !projectId ||
    !userId
  ) {
    return workflowState;
  }

  const mappings = mappedControls(workflowState);

  if (mappings.length === 0) {
    return workflowState;
  }

  const expectedSnapshotId =
    workflowState?.authoritativeArtifacts
      ?.assessmentContext?.systemSnapshotId ||
    workflowState?.authoritativeArtifacts
      ?.controlIntelligence?.systemSnapshotId ||
    null;

  const exact = [];

  for (const mapping of mappings) {
    const detail =
      await getControlIntelligenceControl({
        projectId,
        controlId: mapping.controlId,
        userId
      });

    if (
      !detail?.control?.id ||
      !detail?.chain?.currentStage ||
      !detail?.systemSnapshot?.id ||
      (
        expectedSnapshotId &&
        detail.systemSnapshot.id !== expectedSnapshotId
      )
    ) {
      throw Object.assign(
        new Error(
          'Mapped Control Intelligence detail is unavailable or bound to a different snapshot.'
        ),
        {
          code:
            'MAPPED_CONTROL_AUTHORITY_DETAIL_INVALID'
        }
      );
    }

    exact.push({
      mapping,
      projected: projectionItem(detail)
    });
  }

  const exactControls =
    exact.map((item) => item.projected);
  const applicability =
    exact.filter(
      (item) =>
        item.projected.currentStage === 'applicability'
    );

  if (applicability.length === 1) {
    return applicabilityState({
      workflowState,
      selected: applicability[0].projected,
      mapping: applicability[0].mapping,
      exactControls
    });
  }

  if (applicability.length > 1) {
    return conflictState({
      workflowState,
      exactControls,
      reason:
        'mapped_control_applicability_ambiguous',
      candidateCount: applicability.length
    });
  }

  const projected =
    withExactRelevantControls(
      workflowState,
      exactControls
    );

  const deploymentCandidates =
    exact.filter(
      (item) =>
        item.projected.currentStage ===
          'deployment_decision'
    );

  /*
   * A paginated fallback can be promoted by the persisted gate before this
   * exact-detail guard runs. After a verified closure the same Evidence Plan
   * case can legitimately have both a baseline run and a retest run, which
   * makes that stale bounded-test resolver ambiguous. Exact Phase 2 control
   * detail is stronger than that obsolete fallback. Only when every mapped
   * control has already reached deployment_decision may the guard supersede
   * bounded_test_required or the ambiguity produced from that stale gate.
   */
  if (
    deploymentCandidates.length === exact.length &&
    deploymentCandidates.length > 0 &&
    new Set([
      'bounded_test_required',
      'persisted_lineage_resolution_required'
    ]).has(workflowState.stage)
  ) {
    return readinessReviewState({
      workflowState,
      selected:
        deploymentCandidates.length === 1
          ? deploymentCandidates[0].projected
          : null,
      mapping:
        deploymentCandidates.length === 1
          ? deploymentCandidates[0].mapping
          : null,
      exactControls,
      supersededStage: workflowState.stage
    });
  }

  /*
   * The base workflow can fall back to the Evidence Plan when its ordinary
   * Control Intelligence overview page does not contain a mapped control.
   * A bounded-test fallback is valid only when the exact Phase 2 detail still
   * says that at least one mapped control is at the test stage.
   */
  if (workflowState.stage === 'bounded_test_required') {
    const testCandidates =
      exact.filter(
        (item) => item.projected.currentStage === 'test'
      );

    if (testCandidates.length > 0) {
      return projected;
    }

    return conflictState({
      workflowState,
      exactControls,
      reason:
        'mapped_control_stage_conflicts_with_bounded_fallback',
      candidateCount: exact.length
    });
  }

  return projected;
}
