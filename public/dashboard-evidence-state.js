function completedStep(journey, id) {
  return Array.isArray(journey?.steps)
    && journey.steps.some((step) => step?.id === id && step.complete === true);
}

export function dashboardEvidencePresentation({ journey, hasDeploymentDecision = false, projectId = '' } = {}) {
  const href = projectId
    ? `/control-intelligence.html?projectId=${encodeURIComponent(projectId)}`
    : '/control-intelligence.html';
  const readyForHumanReview = journey?.status === 'ready-for-deployment-review';
  const allowed = completedStep(journey, 'allowed');
  const blocked = completedStep(journey, 'blocked');
  const retested = completedStep(journey, 'retest');

  let runtimeEvidence = null;
  if (allowed && blocked && retested) runtimeEvidence = 'Current-policy allow, deny and retest evidence recorded';
  else if (allowed && blocked) runtimeEvidence = 'Current-policy allow and deny tests recorded';
  else if (allowed || blocked) runtimeEvidence = 'Partial current-policy runtime evidence recorded';

  if (hasDeploymentDecision) {
    return {
      readyForHumanReview,
      deployment: null,
      runtimeEvidence,
      nextAction: {
        title: 'Review the recorded deployment decision',
        detail: 'Review the server-recorded decision, rationale, evidence and scope for this exact system/version.',
        label: 'Open deployment evidence',
        href,
      },
    };
  }

  if (readyForHumanReview) {
    return {
      readyForHumanReview: true,
      deployment: {
        state: 'unresolved',
        title: 'Ready for human review',
        detail: 'Required technical evidence is complete for the current project policy. No deployment decision has been recorded yet.',
      },
      runtimeEvidence,
      nextAction: {
        title: 'Make the deployment decision',
        detail: 'Review the current evidence, limitations and scope, then record Proceed, Hold or Do not deploy for this exact system/version.',
        label: 'Review deployment evidence',
        href,
      },
    };
  }

  return {
    readyForHumanReview: false,
    deployment: null,
    runtimeEvidence,
    nextAction: null,
  };
}
