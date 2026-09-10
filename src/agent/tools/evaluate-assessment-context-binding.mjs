export function evaluateAssessmentContextBinding({
  authoritativeAssessment,
  assessmentContext
} = {}) {
  if (!authoritativeAssessment?.available) {
    return {
      type: 'assessment_context_binding',
      status: 'unavailable',
      verified: false,
      reason: 'authoritative_assessment_required'
    };
  }

  if (!assessmentContext?.available) {
    return {
      type: 'assessment_context_binding',
      status: 'unavailable',
      verified: false,
      reason: 'authoritative_assessment_context_required'
    };
  }

  const declaredAssessmentId =
    String(
      assessmentContext
        ?.assessmentConfiguration
        ?.assessmentBinding
        ?.assessmentId || ''
    ).trim();

  const actualAssessmentId =
    String(
      authoritativeAssessment.assessmentId || ''
    ).trim();

  if (!declaredAssessmentId) {
    return {
      type: 'assessment_context_binding',
      status: 'missing',
      verified: false,
      reason: 'snapshot_assessment_binding_missing',
      assessmentId: actualAssessmentId,
      systemSnapshotId:
        assessmentContext.systemSnapshotId
    };
  }

  if (declaredAssessmentId !== actualAssessmentId) {
    return {
      type: 'assessment_context_binding',
      status: 'mismatch',
      verified: false,
      reason: 'snapshot_assessment_id_mismatch',
      assessmentId: actualAssessmentId,
      declaredAssessmentId,
      systemSnapshotId:
        assessmentContext.systemSnapshotId
    };
  }

  return {
    type: 'assessment_context_binding',
    status: 'verified',
    verified: true,
    assessmentId: actualAssessmentId,
    declaredAssessmentId,
    systemSnapshotId:
      assessmentContext.systemSnapshotId,
    systemSnapshotDigest:
      assessmentContext.systemSnapshotDigest || null
  };
}
