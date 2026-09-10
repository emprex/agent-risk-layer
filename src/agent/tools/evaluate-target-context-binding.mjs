export function evaluateTargetContextBinding({
  target,
  assessmentContext
} = {}) {
  if (!target?.revision) {
    return {
      type: 'target_context_binding',
      status: 'unavailable',
      verified: false,
      reason: 'frozen_target_required'
    };
  }

  if (!assessmentContext?.available) {
    return {
      type: 'target_context_binding',
      status: 'unavailable',
      verified: false,
      reason: 'authoritative_assessment_context_required'
    };
  }

  const declaredBinding =
    assessmentContext
      ?.assessmentConfiguration
      ?.targetBinding || null;

  if (!declaredBinding) {
    return {
      type: 'target_context_binding',
      status: 'missing',
      verified: false,
      reason: 'snapshot_target_binding_missing',

      targetRevision: target.revision,

      systemSnapshotId:
        assessmentContext.systemSnapshotId
    };
  }

  const declaredRevision =
    String(declaredBinding.revision || '')
      .trim()
      .toLowerCase();

  const targetRevision =
    String(target.revision)
      .trim()
      .toLowerCase();

  if (
    !/^[a-f0-9]{40}$/.test(declaredRevision)
  ) {
    return {
      type: 'target_context_binding',
      status: 'invalid',
      verified: false,
      reason: 'snapshot_target_revision_invalid',

      targetRevision,

      declaredRevision:
        declaredRevision || null,

      systemSnapshotId:
        assessmentContext.systemSnapshotId
    };
  }

  if (declaredRevision !== targetRevision) {
    return {
      type: 'target_context_binding',
      status: 'mismatch',
      verified: false,
      reason: 'snapshot_target_revision_mismatch',

      targetRevision,
      declaredRevision,

      systemSnapshotId:
        assessmentContext.systemSnapshotId
    };
  }

  return {
    type: 'target_context_binding',
    status: 'verified',
    verified: true,

    targetRevision,
    declaredRevision,

    systemSnapshotId:
      assessmentContext.systemSnapshotId,

    systemSnapshotDigest:
      assessmentContext.systemSnapshotDigest || null
  };
}
