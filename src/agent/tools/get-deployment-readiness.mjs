export async function getDeploymentReadiness({
  projectId,
  userId
} = {}) {
  if (!projectId || !userId) {
    return {
      type: 'deployment_readiness',
      available: false,
      reason: 'authoritative_project_context_required',
      decision: null,
      message:
        'Deployment readiness requires an authoritative ARL projectId and userId.'
    };
  }

  const persistenceAvailable =
    Boolean(process.env.DATABASE_URL) ||
    (
      process.env.NODE_ENV === 'test' &&
      !process.env.DATABASE_URL
    );

  if (!persistenceAvailable) {
    return {
      type: 'deployment_readiness',
      available: false,
      reason: 'authoritative_persistence_unavailable',
      decision: null,
      projectId,
      message:
        'Deployment readiness requires the authoritative ARL persistence layer. No deployment decision was inferred.'
    };
  }

  const { getDerivedDeploymentReadiness } =
    await import('../../control-intelligence.js');

  const readiness = await getDerivedDeploymentReadiness({
    projectId,
    userId
  });

  if (!readiness?.available) {
    return {
      type: 'deployment_readiness',
      available: false,
      reason: readiness?.reason || 'authoritative_readiness_unavailable',
      decision: null,
      projectId,
      systemSnapshotId: readiness?.systemSnapshotId || null,
      rationale: readiness?.rationale || null,
      humanReviewRequired: true
    };
  }

  return {
    type: 'deployment_readiness',
    available: true,
    projectId,
    systemSnapshotId: readiness.systemSnapshotId,
    systemSnapshotDigest: readiness.systemSnapshotDigest,
    decision: readiness.decision,
    rationale: readiness.rationale,
    summary: readiness.summary,
    reasons: readiness.reasons,
    evidenceIds: readiness.evidenceIds,
    requiredApprovals: readiness.requiredApprovals,
    controlProfileDigest: readiness.controlProfileDigest,
    humanReviewRequired: true
  };
}
