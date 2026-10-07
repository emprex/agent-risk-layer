const PREFIX = 'Set control applicability ';

const DECISIONS = new Set([
  'applicable',
  'not_applicable',
  'context_required'
]);

function clean(value) {
  return String(value ?? '').trim();
}

export function parseLocalApplicabilityCommand(request) {
  const text = clean(request);
  if (!text) return null;

  if (/^Control ARL-KB-\d+ applies$/i.test(text)) {
    throw new Error(
      'Applicable decisions require a specific human rationale. Use Set control applicability with controlId, decision and reason.'
    );
  }

  if (!text.startsWith(PREFIX)) return null;

  let input;
  try {
    input = JSON.parse(text.slice(PREFIX.length));
  } catch {
    throw new Error(
      'Set control applicability requires a valid JSON object.'
    );
  }

  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw new Error(
      'Set control applicability requires a JSON object.'
    );
  }

  const controlId = clean(input.controlId).toUpperCase();
  if (!/^ARL-KB-\d{3}$/.test(controlId)) {
    throw new Error(
      'Set control applicability requires a valid ARL-KB-### controlId.'
    );
  }

  const decision = clean(input.decision).toLowerCase();
  if (!DECISIONS.has(decision)) {
    throw new Error(
      'Applicability decision must be applicable, not_applicable, or context_required.'
    );
  }

  const reason = clean(input.reason);
  if (reason.length < 10) {
    throw new Error(
      'Applicability decisions require a specific human reason of at least 10 characters.'
    );
  }

  let architectureFactIds = null;
  if (Object.hasOwn(input, 'architectureFactIds')) {
    if (!Array.isArray(input.architectureFactIds)) {
      throw new Error(
        'architectureFactIds must be an array of confirmed architecture fact IDs.'
      );
    }
    architectureFactIds = [...new Set(
      input.architectureFactIds
        .map((value) => clean(value))
        .filter(Boolean)
    )].sort();
  }

  /*
   * In local owner mode, a factless not_applicable decision may be accepted
   * only by the dedicated owner-attestation path. The core guided-review API
   * still requires confirmed snapshot facts.
   */

  return {
    controlId,
    decision,
    reason:
      reason ||
      'Explicit local human applicability review',
    architectureFactIds
  };
}


export function focusLocalApplicabilityControl(
  workflowState,
  controlDetail,
  requestedControlId
) {
  const controlId = clean(requestedControlId).toUpperCase();
  const snapshotId =
    workflowState?.authoritativeArtifacts
      ?.assessmentContext?.systemSnapshotId || null;

  if (
    !/^ARL-KB-\d{3}$/.test(controlId) ||
    !snapshotId ||
    controlDetail?.systemSnapshot?.id !== snapshotId ||
    controlDetail?.control?.id !== controlId ||
    controlDetail?.chain?.currentStage !== 'applicability'
  ) {
    return null;
  }

  return {
    ...workflowState,
    stage: 'control_applicability_required',
    blocked: true,
    canAutoAdvance: false,
    blockers: [
      {
        code: 'control_applicability_required',
        source: 'control_intelligence_detail',
        userActionRequired: true
      }
    ],
    scopedControl: {
      controlId,
      currentStage: 'applicability',
      chainStatus:
        controlDetail?.chain?.status ||
        controlDetail?.chain?.chainStatus ||
        'context_required',
      nextAction:
        controlDetail?.chain?.nextAction ||
        'Confirm whether this canonical control applies to the current assessed agent and snapshot.',
      deploymentImpact:
        controlDetail?.chain?.deploymentImpact || 'hold'
    },
    nextAllowedAction: {
      name: 'resolve_control_applicability',
      actor: 'user',
      requiresUserInput: true,
      reason:
        'The operator explicitly selected a canonical Control Intelligence control on the current authoritative snapshot. Applicability remains a human decision.',
      controlId,
      caseId: null
    },
    deploymentDecisionWritten: false,
    humanReviewRequired: true
  };
}

export function localApplicabilityCandidateIds(workflowState) {
  const scoped =
    workflowState?.stage === 'control_applicability_required'
      ? String(workflowState?.scopedControl?.controlId || '').trim()
      : '';

  if (scoped) return [scoped];

  const relevant =
    workflowState?.authoritativeArtifacts
      ?.controlIntelligence?.relevantControls;
  const mapped =
    workflowState?.authoritativeArtifacts
      ?.evidencePlan?.mappedControls;

  if (!Array.isArray(relevant) || !Array.isArray(mapped)) {
    return [];
  }

  const mappedIds = new Set(
    mapped
      .map((item) => String(item?.controlId || '').trim())
      .filter(Boolean)
  );

  return [...new Set(
    relevant
      .filter(
        (item) =>
          item?.currentStage === 'applicability' &&
          mappedIds.has(String(item?.controlId || '').trim())
      )
      .map((item) => String(item.controlId).trim())
      .filter(Boolean)
  )].sort();
}
