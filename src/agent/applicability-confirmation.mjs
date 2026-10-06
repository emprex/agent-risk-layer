import {
  recordControlApplicabilityConfirmation
} from './control-applicability-handoff.mjs';
import {
  getAssessmentControlBinding
} from './assessment-control-bindings.mjs';

export const APPLICABILITY_CONFIRMATION_SCHEMA =
  'arl.agent.applicability-confirmation.v1';

function unavailable(reason) {
  return {
    schema: APPLICABILITY_CONFIRMATION_SCHEMA,
    available: false,
    status: 'blocked',
    reason,
    securityStateChanged: false,
    deploymentDecisionWritten: false,
    humanReviewRequired: true
  };
}

function mappedApplicabilityCandidates(workflowState) {
  const mapped =
    workflowState?.authoritativeArtifacts
      ?.evidencePlan?.mappedControls;
  const relevant =
    workflowState?.authoritativeArtifacts
      ?.controlIntelligence?.relevantControls;
  const mappedIds = new Set(
    (Array.isArray(mapped) ? mapped : [])
      .map((item) => item?.controlId)
      .filter(Boolean)
  );

  return (Array.isArray(relevant) ? relevant : [])
    .filter(
      (item) =>
        item?.controlId &&
        item.currentStage === 'applicability' &&
        mappedIds.has(item.controlId)
    );
}

function isMappedControl(workflowState, controlId) {
  const requested = String(controlId || '').trim();
  if (!requested) return false;

  const mapped =
    workflowState?.authoritativeArtifacts
      ?.evidencePlan?.mappedControls;

  return (Array.isArray(mapped) ? mapped : [])
    .some((item) => item?.controlId === requested);
}

function evidencePlanEntries(evidencePlan) {
  return [
    ...(Array.isArray(evidencePlan?.checks)
      ? evidencePlan.checks
      : []),
    ...(Array.isArray(evidencePlan?.manual)
      ? evidencePlan.manual
      : [])
  ];
}

function evidencePlanControlIds(evidencePlan) {
  const ids = new Set();

  for (const entry of evidencePlanEntries(evidencePlan)) {
    const questionId =
      entry?.gap?.questionId ||
      entry?.questionId ||
      null;

    if (!questionId) continue;

    const binding = getAssessmentControlBinding(questionId);
    if (binding?.available === true && binding.controlId) {
      ids.add(binding.controlId);
    }
  }

  return ids;
}

function isMappedPreparationControl(evidencePlan, controlId) {
  const requested = String(controlId || '').trim();
  if (!requested) return false;

  return evidencePlanControlIds(evidencePlan).has(requested);
}

export function selectApplicabilityWorkflowState(
  workflowState,
  requestedControlId,
  { evidencePlan = null } = {}
) {
  const requested = String(requestedControlId || '').trim();

  if (workflowState?.stage === 'control_applicability_required') {
    const selected = workflowState?.scopedControl || null;

    /*
     * A reconstructed workflow may transiently scope a different mapped
     * applicability control than the one the authenticated operator selected
     * from the displayed review. Only reuse the reconstructed gate when it
     * matches the explicit request. Otherwise fall through and revalidate the
     * requested control against the authoritative mappings below.
     */
    if (
      selected?.controlId &&
      requested &&
      requested === selected.controlId
    ) {
      return workflowState;
    }
  }

  /*
   * A multi-control applicability review is projected from the current
   * authoritative mapped controls. The write path must validate the selected
   * control against that same authoritative candidate set rather than depend
   * on transient guard metadata surviving a second workflow reconstruction.
   * This prevents a displayed control from becoming unselectable between the
   * review response and the explicit human confirmation request.
   */
  if (
    !requested ||
    (
      !isMappedControl(workflowState, requested) &&
      !isMappedPreparationControl(evidencePlan, requested)
    )
  ) {
    return null;
  }

  /*
   * The workflow projection is advisory for navigation; the write authority is
   * revalidated below by recordControlApplicabilityConfirmation against the
   * current assessment snapshot and exact Control Intelligence detail. Build
   * the explicit user gate from the mapped control even if a second workflow
   * reconstruction no longer reproduces the same transient projection.
   */
  const candidates = mappedApplicabilityCandidates(workflowState);
  const selected = candidates.find(
    (item) => item.controlId === requested
  ) || {
    controlId: requested,
    currentStage: 'applicability',
    chainStatus: 'context_required',
    nextAction:
      'Confirm whether this control applies to the current declared agent architecture.',
    deploymentImpact: 'hold'
  };

  return {
    ...workflowState,
    stage: 'control_applicability_required',
    blocked: true,
    canAutoAdvance: false,
    scopedControl: {
      controlId: selected.controlId,
      currentStage: 'applicability',
      chainStatus: selected.chainStatus || 'context_required',
      nextAction:
        selected.nextAction ||
        'Confirm whether this control applies to the current declared agent architecture.',
      deploymentImpact: selected.deploymentImpact || 'hold'
    },
    nextAllowedAction: {
      name: 'resolve_control_applicability',
      actor: 'user',
      requiresUserInput: true,
      reason:
        'The authenticated customer explicitly selected one authoritative mapped control to review. ARL still requires a Control Intelligence applicability decision for that control.',
      controlId: selected.controlId,
      caseId: null
    }
  };
}

export async function confirmMappedControlApplicability({
  workflowState,
  projectId,
  userId,
  controlId,
  decision = 'applicable',
  reason = '',
  architectureFactIds = null,
  evidencePlan = null
} = {}) {
  if (!projectId || !userId) {
    return unavailable('applicability_authority_required');
  }

  const selectedState = selectApplicabilityWorkflowState(
    workflowState,
    controlId,
    { evidencePlan }
  );
  if (!selectedState) {
    return unavailable(
      'applicability_control_selection_required'
    );
  }

  const handoff = await recordControlApplicabilityConfirmation({
    workflowState: selectedState,
    projectId,
    userId,
    decision,
    reason,
    architectureFactIds
  });

  if (handoff?.available !== true) {
    return unavailable(
      handoff?.reason || 'applicability_confirmation_blocked'
    );
  }

  return {
    schema: APPLICABILITY_CONFIRMATION_SCHEMA,
    available: true,
    status: handoff.status,
    controlId: handoff.controlId || String(controlId || '').trim() || null,
    applicabilityDecision: handoff.applicabilityDecision || null,
    applicabilityReason: handoff.applicabilityReason || null,
    securityStateChanged: handoff.securityStateChanged === true,
    deploymentDecisionWritten: false,
    humanReviewRequired: true
  };
}
