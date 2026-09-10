import {
  recordControlApplicabilityConfirmation
} from './control-applicability-handoff.mjs';

export const HOSTED_APPLICABILITY_CONFIRMATION_SCHEMA =
  'arl.agent.hosted-applicability-confirmation.v1';

function unavailable(reason) {
  return {
    schema: HOSTED_APPLICABILITY_CONFIRMATION_SCHEMA,
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

function selectedWorkflowState(workflowState, requestedControlId) {
  const requested = String(requestedControlId || '').trim();

  if (workflowState?.stage === 'control_applicability_required') {
    const selected = workflowState?.scopedControl || null;
    if (!selected?.controlId) return null;
    if (requested && requested !== selected.controlId) return null;
    return workflowState;
  }

  const ambiguity =
    workflowState?.stage === 'persisted_lineage_resolution_required' &&
    workflowState?.mappedControlAuthorityGuard?.ambiguity === true &&
    workflowState?.mappedControlAuthorityGuard?.reason ===
      'mapped_control_applicability_ambiguous';
  if (!ambiguity || !requested) return null;

  const candidates = mappedApplicabilityCandidates(workflowState);
  const selected = candidates.find(
    (item) => item.controlId === requested
  );
  if (!selected) return null;

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

export async function confirmHostedMappedControlApplicability({
  workflowState,
  projectId,
  userId,
  controlId,
  decision = 'applicable',
  reason = '',
  architectureFactIds = null
} = {}) {
  if (!projectId || !userId) {
    return unavailable('hosted_applicability_authority_required');
  }

  const selectedState = selectedWorkflowState(
    workflowState,
    controlId
  );
  if (!selectedState) {
    return unavailable(
      'hosted_applicability_control_selection_required'
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
      handoff?.reason || 'hosted_applicability_confirmation_blocked'
    );
  }

  return {
    schema: HOSTED_APPLICABILITY_CONFIRMATION_SCHEMA,
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
