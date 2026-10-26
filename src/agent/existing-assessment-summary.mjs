// Bounded read-only selection metadata for the Python Operator.
// This is a projection, not a new database reader or security authority.
const SHA = /^[a-f0-9]{40}$/;
const IDENTIFIER = /^[a-zA-Z0-9._:-]{1,160}$/;

export const EXISTING_ASSESSMENT_SUMMARY_SCHEMA =
  'arl.operator.existing-assessment-summary.v1';

export function existingAssessmentSummary({
  view = null,
  binding = null,
  frozenRevision = '',
  reason = null
} = {}) {
  const base = {
    schema: EXISTING_ASSESSMENT_SUMMARY_SCHEMA,
    available: false,
    reason: 'unavailable',
    securityStateChanged: false,
    deploymentDecisionWritten: false,
    humanReviewRequired: true,
    securityVerdict: 'not_assessed',
    readinessDecision: 'not_evaluated'
  };

  if (!SHA.test(frozenRevision)) throw new Error('Exact frozen Git SHA required.');
  if (!binding) {
    return {...base, reason: reason === 'not_found' ? 'not_found' : 'unavailable'};
  }
  if (view?.available !== true) {
    return {...base, reason: 'assessment_context_unavailable'};
  }

  const ids = [
    binding.projectId, binding.assessmentId, view.projectId,
    view.systemSnapshotId
  ];
  if (ids.some(value => typeof value !== 'string' || !IDENTIFIER.test(value)) ||
      binding.projectId !== view.projectId ||
      !SHA.test(view.targetBinding?.revision || '') ||
      view.targetBinding.revision !== frozenRevision ||
      view.securityStateChanged !== false ||
      view.deploymentDecisionWritten !== false ||
      view.humanReviewRequired !== true) {
    throw new Error('Canonical assessment binding or authority mismatch.');
  }
  return {
    ...base,
    available: true,
    reason: null,
    projectId: binding.projectId,
    assessmentId: binding.assessmentId,
    systemSnapshotId: view.systemSnapshotId,
    targetRevision: frozenRevision,
    // Only a recorded environment from the bounded allowed vocabulary is shown.
    environment: ['test', 'staging', 'production', 'development'].includes(view.environment)
      ? view.environment : 'not_recorded',
    // A found snapshot does NOT establish applicable controls, passed tests,
    // evidence acceptance, findings, closure or deployment readiness.
    snapshotPresent: true,
    evidenceState: 'not_inspected',
    controlOutcomes: 'not_inspected'
  };
}
