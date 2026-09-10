export async function getAssessmentContext({
  projectId,
  userId
} = {}) {
  if (!projectId || !userId) {
    return {
      type: 'assessment_context',
      available: false,
      reason: 'authoritative_project_context_required',
      projectId: projectId || null
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
      type: 'assessment_context',
      available: false,
      reason: 'authoritative_persistence_unavailable',
      projectId
    };
  }

  const { getControlIntelligence } =
    await import('../../control-intelligence.js');
  const { getDerivedDeploymentReadiness } =
    await import('../../control-intelligence-core.js');

  const readiness = await getDerivedDeploymentReadiness({
    projectId,
    userId
  });

  if (
    readiness?.available !== true &&
    readiness?.reason === 'current_system_snapshot_required'
  ) {
    return {
      type: 'assessment_context',
      available: false,
      reason: 'authoritative_system_snapshot_required',
      projectId
    };
  }

  const intelligence = await getControlIntelligence({
    projectId,
    userId
  });

  const snapshot = intelligence?.systemSnapshot || null;

  if (!snapshot?.id) {
    return {
      type: 'assessment_context',
      available: false,
      reason: 'authoritative_system_snapshot_required',
      projectId
    };
  }

  return {
    type: 'assessment_context',
    available: true,

    projectId,

    systemSnapshotId: snapshot.id,
    systemSnapshotDigest:
      snapshot.contentDigest || null,

    systemSnapshotStatus:
      snapshot.status || null,

    source:
      snapshot.source || null,

    architecture:
      snapshot.architecture || null,

    models:
      Array.isArray(snapshot.models)
        ? snapshot.models
        : [],

    tools:
      Array.isArray(snapshot.tools)
        ? snapshot.tools
        : [],

    identities:
      Array.isArray(snapshot.identities)
        ? snapshot.identities
        : [],

    dataSources:
      Array.isArray(snapshot.dataSources)
        ? snapshot.dataSources
        : [],

    networkAccess:
      Array.isArray(snapshot.networkAccess)
        ? snapshot.networkAccess
        : [],

    autonomyLevel:
      snapshot.autonomyLevel || null,

    approvalConfiguration:
      snapshot.approvalConfiguration || {},

    assessmentConfiguration:
      snapshot.assessmentConfiguration || {}
  };
}
