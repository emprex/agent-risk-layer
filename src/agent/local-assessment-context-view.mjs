import {
  getAssessmentContext
} from './tools/get-assessment-context.mjs';

export const LOCAL_ASSESSMENT_CONTEXT_VIEW_SCHEMA =
  'arl.local-assessment-context-view.v1';

function clean(value) {
  const text = String(value ?? '').trim();
  return text || null;
}

function sortedStrings(value) {
  return Array.isArray(value)
    ? [...new Set(
        value
          .map((item) => clean(item))
          .filter(Boolean)
      )].sort()
    : [];
}

function capabilityProfileProjection(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return null;
  }

  const {
    version = null,
    evidenceState = null,
    autonomy = null,
    memory = null,
    toolDiscovery = null,
    delegation = null,
    goals = null,
    learning = null,
    evaluatorAuthority = null,
    triggerMode = null,
    aggregateResourceControl = null,
    instructionAuthority = null,
    instructionActivation = null,
    instructionProvenance = null,
    rollbackScope = [],
    externalTrust = [],
    inputChannels = [],
    instructionSources = []
  } = value;

  return {
    version,
    evidenceState,
    autonomy,
    memory,
    toolDiscovery,
    delegation,
    goals,
    learning,
    evaluatorAuthority,
    triggerMode,
    aggregateResourceControl,
    instructionAuthority,
    instructionActivation,
    instructionProvenance,
    rollbackScope: sortedStrings(rollbackScope),
    externalTrust: sortedStrings(externalTrust),
    inputChannels: sortedStrings(inputChannels),
    instructionSources: sortedStrings(instructionSources)
  };
}

export function projectLocalAssessmentContext(context) {
  if (context?.available !== true) {
    return {
      schema: LOCAL_ASSESSMENT_CONTEXT_VIEW_SCHEMA,
      available: false,
      reason:
        clean(context?.reason) ||
        'authoritative_assessment_context_unavailable',
      securityStateChanged: false,
      deploymentDecisionWritten: false,
      humanReviewRequired: true
    };
  }

  const configuration =
    context.assessmentConfiguration || {};
  const targetBinding =
    configuration.targetBinding || {};

  return {
    schema: LOCAL_ASSESSMENT_CONTEXT_VIEW_SCHEMA,
    available: true,
    systemSnapshotId:
      clean(context.systemSnapshotId),
    architectureSummary:
      clean(context.architecture?.summary),
    environment:
      clean(configuration.environment),
    capabilityProfile:
      capabilityProfileProjection(
        configuration.capabilityProfile
      ),
    confirmedArchitectureFacts:
      sortedStrings(
        configuration.architectureFacts
      ),
    manualArchitectureFacts:
      sortedStrings(
        configuration.manualArchitectureFacts
      ),
    targetBinding: {
      revision:
        clean(targetBinding.revision),
      repository:
        clean(
          targetBinding.repository ||
          targetBinding.repositoryPath ||
          targetBinding.name
        )
    },
    securityStateChanged: false,
    deploymentDecisionWritten: false,
    humanReviewRequired: true
  };
}

export async function showLocalAssessmentContext({
  projectId,
  userId
} = {}) {
  const context =
    await getAssessmentContext({
      projectId,
      userId
    });

  const view =
    projectLocalAssessmentContext(context);

  if (!view.available) {
    return {
      canonicalData: view,
      answer:
        'Authoritative assessment context is unavailable. No security state was changed.'
    };
  }

  const profile =
    view.capabilityProfile || {};

  const lines = [
    'AUTHORITATIVE ASSESSMENT CONTEXT',
    '',
    `System snapshot: ${view.systemSnapshotId || 'not recorded'}`,
    `Target revision: ${view.targetBinding.revision || 'not recorded'}`,
    `Target repository: ${view.targetBinding.repository || 'not recorded'}`,
    `Environment: ${view.environment || 'not recorded'}`,
    '',
    'Architecture summary:',
    view.architectureSummary || 'not recorded',
    '',
    'Capability profile:',
    JSON.stringify(profile, null, 2),
    '',
    'Confirmed architecture facts:',
    view.confirmedArchitectureFacts.length
      ? view.confirmedArchitectureFacts
          .map((fact) => `- ${fact}`)
          .join('\n')
      : '- none recorded',
    '',
    'Manual architecture facts:',
    view.manualArchitectureFacts.length
      ? view.manualArchitectureFacts
          .map((fact) => `- ${fact}`)
          .join('\n')
      : '- none recorded',
    '',
    'Read-only view. No security state was changed.',
    'Human final deployment decision remains required.'
  ];

  return {
    canonicalData: view,
    answer: lines.join('\n')
  };
}
