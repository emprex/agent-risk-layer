import {
  resolvePersistedRedTeamContinuation
} from './tools/resolve-persisted-redteam-continuation.mjs';

import {
  resolvePersistedExactRetestContinuation
} from './tools/resolve-persisted-exact-retest-continuation.mjs';

const AMBIGUITY_REASONS = new Set([
  'persisted_redteam_continuation_ambiguous',
  'persisted_redteam_lineage_ambiguous',
  'persisted_failed_redteam_baseline_ambiguous',
  'persisted_exact_retest_ambiguous',
  'redteam_control_evidence_ambiguous'
]);

function parseJson(value, fallback = {}) {
  try {
    return value && typeof value === 'object'
      ? value
      : JSON.parse(value || '{}');
  } catch {
    return fallback;
  }
}

function evidencePlanFromState(workflowState) {
  const projected =
    workflowState?.authoritativeArtifacts?.evidencePlan;

  if (projected?.available !== true) {
    return null;
  }

  const mapped =
    Array.isArray(projected.mappedControls)
      ? projected.mappedControls
      : [];

  return {
    type: 'evidence_plan',
    available: true,
    state: projected.state || null,
    checks: mapped
      .filter((item) => item.caseId)
      .map((item) => ({
        id: item.planId || null,
        caseId: item.caseId,
        gap: {
          questionId: item.questionId || null
        }
      })),
    manual: []
  };
}

function caseIdForControl(workflowState, controlId) {
  const mapped =
    workflowState?.authoritativeArtifacts
      ?.evidencePlan?.mappedControls;

  if (!Array.isArray(mapped)) {
    return null;
  }

  return mapped.find(
    (item) => item?.controlId === controlId && item?.caseId
  )?.caseId || null;
}

function withRelevantControl(
  workflowState,
  {
    controlId,
    currentStage,
    chainStatus,
    deploymentImpact = 'blocker',
    availableActions = []
  }
) {
  const artifacts =
    workflowState?.authoritativeArtifacts || {};
  const intelligence =
    artifacts.controlIntelligence || {};
  const existing =
    Array.isArray(intelligence.relevantControls)
      ? intelligence.relevantControls
      : [];

  const next = [
    ...existing.filter(
      (item) => item?.controlId !== controlId
    ),
    {
      controlId,
      currentStage,
      chainStatus,
      deploymentImpact,
      availableActions
    }
  ];

  return {
    ...workflowState,
    authoritativeArtifacts: {
      ...artifacts,
      controlIntelligence: {
        ...intelligence,
        available: true,
        relevantControls: next
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

function freshRemediationApplicabilityState({
  workflowState,
  controlId,
  findingId,
  previousSystemSnapshotId,
  reason =
    'The changed remediation snapshot requires a fresh guided customer applicability review before exact retesting can continue.'
}) {
  const caseId =
    caseIdForControl(workflowState, controlId);

  let next = withRelevantControl(
    workflowState,
    {
      controlId,
      currentStage: 'applicability',
      chainStatus: 'context_required',
      deploymentImpact: 'hold',
      availableActions: []
    }
  );

  next = maskReadiness(
    next,
    'fresh_remediation_applicability_review_required'
  );

  return {
    ...next,
    stage: 'control_applicability_required',
    blocked: true,
    canAutoAdvance: false,
    blockers: [
      {
        code:
          'fresh_remediation_applicability_review_required',
        source: 'persisted_remediation_snapshot',
        userActionRequired: true
      }
    ],
    scopedControl: {
      controlId,
      currentStage: 'applicability',
      chainStatus: 'context_required',
      nextAction: reason,
      deploymentImpact: 'hold'
    },
    nextAllowedAction: {
      name: 'resolve_control_applicability',
      actor: 'user',
      requiresUserInput: true,
      reason,
      controlId,
      caseId
    },
    conversationGatePolicy: {
      applied: true,
      gate: 'control_applicability',
      automaticDecisionAllowed: false,
      source: 'persisted_remediation_snapshot'
    },
    remediationSnapshotGate: {
      active: true,
      findingId,
      controlId,
      previousSystemSnapshotId,
      freshApplicabilityRequired: true
    }
  };
}

function remediationLineageAmbiguousState({
  workflowState,
  reason,
  candidateCount = 0
}) {
  const next = maskReadiness(
    workflowState,
    reason
  );

  return {
    ...next,
    stage: 'remediation_lineage_resolution_required',
    blocked: true,
    canAutoAdvance: false,
    blockers: [
      {
        code: reason,
        source: 'persisted_remediation_snapshot',
        userActionRequired: true
      }
    ],
    nextAllowedAction: {
      name: 'review_remediation_lineage',
      actor: 'human',
      requiresUserInput: true,
      reason:
        'The remediation snapshot points back to more than one unresolved finding lineage. ARL will not choose which finding the changed snapshot remediates.',
      controlId: null,
      caseId: null
    },
    remediationSnapshotGate: {
      active: true,
      ambiguity: true,
      reason,
      candidateCount
    }
  };
}

function remediationApplicabilityConflictState({
  workflowState,
  controlId,
  findingId,
  previousSystemSnapshotId
}) {
  const next = maskReadiness(
    workflowState,
    'remediation_applicability_conflict'
  );

  return {
    ...next,
    stage: 'remediation_applicability_conflict',
    blocked: true,
    canAutoAdvance: false,
    blockers: [
      {
        code: 'remediation_applicability_conflict',
        source: 'persisted_remediation_snapshot',
        userActionRequired: true
      }
    ],
    scopedControl: {
      controlId,
      currentStage: 'applicability',
      chainStatus: 'conflict',
      nextAction:
        'Review why an open remediated finding is now marked not applicable after the architecture was confirmed unchanged.',
      deploymentImpact: 'blocker'
    },
    nextAllowedAction: {
      name: 'review_remediation_applicability_conflict',
      actor: 'human',
      requiresUserInput: true,
      reason:
        'An open finding from the previous snapshot cannot silently disappear because the remediated snapshot was marked not applicable while the architecture was confirmed unchanged.',
      controlId,
      caseId:
        caseIdForControl(workflowState, controlId)
    },
    remediationSnapshotGate: {
      active: true,
      findingId,
      controlId,
      previousSystemSnapshotId,
      applicabilityConflict: true
    }
  };
}

function exactRetestState({
  workflowState,
  controlId,
  findingId,
  previousSystemSnapshotId,
  chain = null
}) {
  const caseId =
    caseIdForControl(workflowState, controlId);

  let next = withRelevantControl(
    workflowState,
    {
      controlId,
      currentStage: 'retest',
      chainStatus:
        chain?.chainStatus || 'remediation_in_progress',
      deploymentImpact:
        chain?.deploymentImpact || 'blocker',
      availableActions:
        Array.isArray(chain?.availableActions)
          ? chain.availableActions
          : ['record_retest']
    }
  );

  next = maskReadiness(
    next,
    'exact_retest_required'
  );

  return {
    ...next,
    stage: 'exact_retest_required',
    blocked: true,
    canAutoAdvance: false,
    blockers: [
      {
        code: 'exact_retest_required',
        source: 'persisted_remediation_snapshot',
        userActionRequired: true
      }
    ],
    scopedControl: {
      controlId,
      currentStage: 'retest',
      chainStatus:
        chain?.chainStatus || 'remediation_in_progress',
      nextAction:
        chain?.nextAction ||
        'Retest the exact original failure against the remediated snapshot.',
      deploymentImpact:
        chain?.deploymentImpact || 'blocker'
    },
    nextAllowedAction: {
      name: 'authorise_and_run_exact_retest',
      actor: 'user',
      requiresUserInput: true,
      reason:
        chain?.nextAction ||
        'The original failure remains open and must be retested with exact lineage against the changed snapshot.',
      controlId,
      caseId
    },
    remediationSnapshotGate: {
      active: true,
      findingId,
      controlId,
      previousSystemSnapshotId,
      freshApplicabilityRequired: false,
      exactRetestRequired: true
    }
  };
}

async function applyRemediationSnapshotPolicy({
  workflowState,
  projectId,
  userId
}) {
  if (
    !workflowState?.available ||
    !projectId ||
    !userId
  ) {
    return workflowState;
  }

  const snapshotId =
    workflowState?.authoritativeArtifacts
      ?.assessmentContext?.systemSnapshotId ||
    workflowState?.readiness?.systemSnapshotId ||
    null;

  if (!snapshotId) {
    return workflowState;
  }

  const { db } = await import('../db.js');
  const snapshot = await db.prepare(`
    SELECT assessment_configuration_json
    FROM system_snapshots
    WHERE id=? AND project_id=? AND status='current'
  `).get(snapshotId, projectId);

  if (!snapshot) {
    return workflowState;
  }

  const configuration =
    parseJson(snapshot.assessment_configuration_json, {});
  const marker =
    configuration?.remediationSnapshotConfirmation;

  if (
    marker?.schema !==
      'arl.remediation-snapshot-confirmation.v1' ||
    marker.architectureUnchanged !== true ||
    !marker.previousSystemSnapshotId
  ) {
    return workflowState;
  }

  const candidates = await db.prepare(`
    SELECT DISTINCT
      r.id AS finding_id,
      r.status AS finding_status,
      b.entry_id AS control_id
    FROM remediation_items r
    JOIN control_finding_bindings b
      ON b.finding_id=r.id
     AND b.project_id=r.project_id
    WHERE r.project_id=?
      AND b.system_snapshot_id=?
      AND r.status NOT IN ('verified_closed','accepted_risk')
    ORDER BY r.updated_at DESC,r.id
  `).all(
    projectId,
    marker.previousSystemSnapshotId
  );

  if (candidates.length === 0) {
    return workflowState;
  }

  if (candidates.length !== 1) {
    return remediationLineageAmbiguousState({
      workflowState,
      reason:
        'persisted_remediation_snapshot_lineage_ambiguous',
      candidateCount: candidates.length
    });
  }

  const lineage = candidates[0];
  const applicability = await db.prepare(`
    SELECT decision,reason,evaluated_at
    FROM control_applicability_revisions
    WHERE project_id=?
      AND system_snapshot_id=?
      AND entry_id=?
    ORDER BY evaluated_at DESC,id DESC
    LIMIT 1
  `).get(
    projectId,
    snapshotId,
    lineage.control_id
  );

  if (
    !applicability ||
    applicability.decision === 'context_required'
  ) {
    return freshRemediationApplicabilityState({
      workflowState,
      controlId: lineage.control_id,
      findingId: lineage.finding_id,
      previousSystemSnapshotId:
        marker.previousSystemSnapshotId
    });
  }

  if (applicability.decision === 'not_applicable') {
    return remediationApplicabilityConflictState({
      workflowState,
      controlId: lineage.control_id,
      findingId: lineage.finding_id,
      previousSystemSnapshotId:
        marker.previousSystemSnapshotId
    });
  }

  if (applicability.decision !== 'applicable') {
    return freshRemediationApplicabilityState({
      workflowState,
      controlId: lineage.control_id,
      findingId: lineage.finding_id,
      previousSystemSnapshotId:
        marker.previousSystemSnapshotId
    });
  }

  const { getControlIntelligenceControl } =
    await import('../control-intelligence.js');
  const detail =
    await getControlIntelligenceControl({
      projectId,
      controlId: lineage.control_id,
      userId
    });

  if (
    detail?.systemSnapshot?.id === snapshotId &&
    detail?.chain?.currentStage === 'retest'
  ) {
    return exactRetestState({
      workflowState,
      controlId: lineage.control_id,
      findingId: lineage.finding_id,
      previousSystemSnapshotId:
        marker.previousSystemSnapshotId,
      chain: detail.chain
    });
  }

  if (
    detail?.systemSnapshot?.id === snapshotId &&
    detail?.chain?.currentStage === 'remediation'
  ) {
    return maskReadiness(
      workflowState,
      'remediation_state_not_ready_for_retest'
    );
  }

  if (
    detail?.systemSnapshot?.id === snapshotId &&
    detail?.chain?.currentStage === 'deployment_decision'
  ) {
    return remediationLineageAmbiguousState({
      workflowState,
      reason:
        'open_finding_retest_lineage_not_reflected',
      candidateCount: 1
    });
  }

  return workflowState;
}

function enforceConversationGatePolicy(workflowState) {
  const action =
    workflowState?.nextAllowedAction;

  if (
    workflowState?.stage ===
      'control_applicability_required' &&
    action?.name ===
      'resolve_control_applicability'
  ) {
    return {
      ...workflowState,
      blocked: true,
      canAutoAdvance: false,
      blockers: [
        {
          code:
            'guided_customer_applicability_review_required',
          source: 'control_intelligence',
          userActionRequired: true
        }
      ],
      nextAllowedAction: {
        ...action,
        actor: 'user',
        requiresUserInput: true,
        reason:
          'Control applicability requires an explicit guided customer review with a decision, specific reason and confirmed architecture facts. ARL does not infer or auto-copy that decision.'
      },
      conversationGatePolicy: {
        ...(workflowState.conversationGatePolicy || {}),
        applied: true,
        gate: 'control_applicability',
        automaticDecisionAllowed: false
      }
    };
  }

  return workflowState;
}

function promotedState({
  workflowState,
  stage,
  actionName,
  reason,
  gate,
  selectionBasis,
  selectedRunId = null
}) {
  return {
    ...workflowState,
    stage,
    blocked: false,
    canAutoAdvance: true,
    blockers: [],
    nextAllowedAction: {
      ...workflowState.nextAllowedAction,
      name: actionName,
      actor: 'arl',
      requiresUserInput: false,
      reason,
      selectedRunId
    },
    persistedGate: {
      satisfied: true,
      gate,
      selectionBasis
    }
  };
}

function ambiguousState({
  workflowState,
  reason,
  gate,
  candidates = []
}) {
  return {
    ...workflowState,
    stage: 'persisted_lineage_resolution_required',
    blocked: true,
    canAutoAdvance: false,
    blockers: [
      {
        code: reason,
        source: 'persisted_authoritative_lineage',
        userActionRequired: true
      }
    ],
    nextAllowedAction: {
      name: 'review_persisted_lineage_ambiguity',
      actor: 'human',
      requiresUserInput: true,
      reason:
        'More than one authoritative persisted lineage can satisfy the current gate. ARL will not choose between them automatically.',
      controlId:
        workflowState.nextAllowedAction?.controlId || null,
      caseId:
        workflowState.nextAllowedAction?.caseId || null
    },
    persistedGate: {
      satisfied: false,
      gate,
      ambiguity: true,
      reason,
      candidates: Array.isArray(candidates)
        ? candidates
        : []
    }
  };
}

export async function applyPersistedGateState({
  workflowState,
  projectId,
  userId,
  assessmentId,
  evidencePlan = null,
  selectedRunId = null,
  resolveBoundedContinuation =
    resolvePersistedRedTeamContinuation,
  resolveExactRetestContinuation =
    resolvePersistedExactRetestContinuation
} = {}) {
  workflowState =
    await applyRemediationSnapshotPolicy({
      workflowState,
      projectId,
      userId
    });

  workflowState =
    enforceConversationGatePolicy(workflowState);

  const authoritativeEvidencePlan =
    evidencePlan ||
    evidencePlanFromState(workflowState);

  if (
    !workflowState?.available ||
    !workflowState?.nextAllowedAction ||
    !projectId ||
    !userId ||
    !assessmentId ||
    !authoritativeEvidencePlan?.available
  ) {
    return workflowState;
  }

  const action = workflowState.nextAllowedAction;

  if (
    workflowState.stage === 'bounded_test_required' &&
    action.name === 'authorise_and_run_bounded_test' &&
    action.actor === 'user'
  ) {
    const continuation =
      await resolveBoundedContinuation({
        projectId,
        userId,
        assessmentId,
        evidencePlan: authoritativeEvidencePlan,
        caseId: action.caseId,
        controlId: action.controlId,
        selectedRunId
      });

    if (continuation.available) {
      return promotedState({
        workflowState,
        stage: 'evidence_recording_required',
        actionName: 'record_authoritative_evidence',
        reason:
          'The authorised bounded Red Team run is already persisted and uniquely satisfies the user testing gate. ARL may now bind its authoritative result as control evidence.',
        gate: 'bounded_test',
        selectionBasis:
          continuation.selectionBasis,
        selectedRunId: continuation.runId
      });
    }

    if (AMBIGUITY_REASONS.has(continuation.reason)) {
      return ambiguousState({
        workflowState,
        reason: continuation.reason,
        gate: 'bounded_test',
        candidates: continuation.candidates || []
      });
    }

    return workflowState;
  }

  if (
    workflowState.stage === 'exact_retest_required' &&
    action.name === 'authorise_and_run_exact_retest' &&
    action.actor === 'user'
  ) {
    const continuation =
      await resolveExactRetestContinuation({
        projectId,
        userId,
        assessmentId,
        evidencePlan: authoritativeEvidencePlan,
        caseId: action.caseId,
        controlId: action.controlId
      });

    if (continuation.available) {
      return promotedState({
        workflowState,
        stage: 'exact_retest_completion_ready',
        actionName: 'complete_authoritative_retest',
        reason:
          'A unique authorised exact retest is already persisted with the required baseline lineage. ARL may now verify and record the retest result.',
        gate: 'exact_retest',
        selectionBasis:
          continuation.selectionBasis
      });
    }

    if (AMBIGUITY_REASONS.has(continuation.reason)) {
      return ambiguousState({
        workflowState,
        reason: continuation.reason,
        gate: 'exact_retest',
        candidates: continuation.candidates || []
      });
    }
  }

  return workflowState;
}
