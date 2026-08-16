function completedStep(journey, id) {
  return Array.isArray(journey?.steps)
    && journey.steps.some((step) => step?.id === id && step.complete === true);
}

function controlIntelligenceHref(projectId, controlId = '') {
  if (!projectId) return '/control-intelligence.html';
  if (controlId) {
    return `/control-intelligence-control.html?projectId=${encodeURIComponent(projectId)}&controlId=${encodeURIComponent(controlId)}`;
  }
  return `/control-intelligence.html?projectId=${encodeURIComponent(projectId)}`;
}

export function dashboardEvidencePresentation({ journey, controlIntelligence = null, hasDeploymentDecision = false, projectId = '' } = {}) {
  const deploymentHref = controlIntelligenceHref(projectId);
  const runtimeReady = journey?.status === 'ready-for-deployment-review';
  const allowed = completedStep(journey, 'allowed');
  const blocked = completedStep(journey, 'blocked');
  const retested = completedStep(journey, 'retest');

  let runtimeEvidence = null;
  if (allowed && blocked && retested) runtimeEvidence = 'Current-policy allow, deny and retest evidence recorded';
  else if (allowed && blocked) runtimeEvidence = 'Current-policy allow and deny tests recorded';
  else if (allowed || blocked) runtimeEvidence = 'Partial current-policy runtime evidence recorded';

  if (hasDeploymentDecision) {
    return {
      readyForHumanReview: false,
      deployment: null,
      runtimeEvidence,
      showControlSummary: Boolean(controlIntelligence?.systemSnapshot),
      nextAction: {
        title: 'Review the recorded deployment decision',
        detail: 'Review the server-recorded decision, rationale, evidence and scope for this exact system/version.',
        label: 'Open deployment evidence',
        href: deploymentHref,
      },
    };
  }

  const snapshot = controlIntelligence?.systemSnapshot || null;
  if (!snapshot) {
    return {
      readyForHumanReview: false,
      deployment: {
        state: 'information',
        title: 'Evidence foundation required',
        detail: 'Runtime evidence may be recorded, but no immutable system snapshot exists for deployment evidence. No deployment decision can be recorded yet.',
      },
      runtimeEvidence,
      showControlSummary: false,
      nextAction: {
        title: 'Describe this exact agent version',
        detail: 'Create the privacy-safe immutable system snapshot before reviewing controls or recording a deployment decision.',
        label: 'Create evidence foundation',
        href: deploymentHref,
      },
    };
  }

  const summary = controlIntelligence?.summary || {};
  const controlNext = summary.nextAction || null;
  if (controlNext) {
    return {
      readyForHumanReview: false,
      deployment: {
        state: 'unresolved',
        title: 'Deployment review in progress',
        detail: 'The immutable system snapshot exists, but control, evidence, retest or approval work remains before the deployment decision.',
      },
      runtimeEvidence,
      showControlSummary: true,
      nextAction: {
        title: 'Continue deployment evidence review',
        detail: controlNext.nextAction || 'Continue the next required control stage for this exact system version.',
        label: controlNext.controlId ? 'Review next control' : 'Continue review',
        href: controlIntelligenceHref(projectId, controlNext.controlId || ''),
      },
    };
  }

  if (!runtimeReady) {
    return {
      readyForHumanReview: false,
      deployment: {
        state: 'unresolved',
        title: 'Runtime evidence incomplete',
        detail: 'Control review has no remaining required stage, but the current runtime evidence journey is not complete.',
      },
      runtimeEvidence,
      showControlSummary: true,
      nextAction: {
        title: 'Complete the current-policy runtime evidence',
        detail: 'Finish the required runtime allow, deny, inventory, remediation and retest steps before deployment review.',
        label: 'Open Runtime',
        href: projectId ? `/control-plane.html?projectId=${encodeURIComponent(projectId)}` : '/control-plane.html',
      },
    };
  }

  return {
    readyForHumanReview: true,
    deployment: {
      state: 'unresolved',
      title: 'Ready for human review',
      detail: 'The immutable system scope, required control stages and current-policy runtime evidence are complete. No deployment decision has been recorded yet.',
    },
    runtimeEvidence,
    showControlSummary: true,
    nextAction: {
      title: 'Make the deployment decision',
      detail: 'Review the current evidence, limitations and scope, then record the server-derived human deployment decision for this exact system/version.',
      label: 'Review deployment evidence',
      href: deploymentHref,
    },
  };
}
