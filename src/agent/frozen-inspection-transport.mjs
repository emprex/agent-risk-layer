export const FROZEN_INSPECTION_TRANSPORT_SCHEMA =
  'arl.agent.frozen-inspection-transport.v1';

function transportError(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}

function cleanRevision(value) {
  const revision = String(value || '').trim().toLowerCase();
  if (!/^[a-f0-9]{40}$/.test(revision)) {
    throw transportError(
      'FROZEN_INSPECTION_REVISION_INVALID',
      'A full 40-character Git revision is required.'
    );
  }
  return revision;
}

function assertInspectionObject(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw transportError(
      'FROZEN_INSPECTION_REQUIRED',
      'A frozen Inspector result is required.'
    );
  }
  return value;
}

export function buildFrozenInspectionTransport(frozenInspection) {
  const frozen = assertInspectionObject(frozenInspection);
  if (frozen.type !== 'frozen_inspection') {
    throw transportError(
      'FROZEN_INSPECTION_TYPE_INVALID',
      'Only a locally verified frozen inspection may be transported.'
    );
  }

  const revision = cleanRevision(frozen?.target?.revision);
  const before = cleanRevision(frozen?.binding?.revisionBefore);
  const after = cleanRevision(frozen?.binding?.revisionAfter);

  if (
    frozen?.target?.dirty === true ||
    frozen?.binding?.verified !== true ||
    before !== revision ||
    after !== revision
  ) {
    throw transportError(
      'FROZEN_INSPECTION_BINDING_INVALID',
      'The transported inspection must remain bound to one clean frozen Git revision.'
    );
  }

  const inspection = assertInspectionObject(frozen.inspection);

  return {
    schema: FROZEN_INSPECTION_TRANSPORT_SCHEMA,
    type: 'frozen_inspection_transport',
    target: {
      source: 'local_git',
      revision,
      dirty: false
    },
    binding: {
      verified: true,
      revisionBefore: revision,
      revisionAfter: revision
    },
    inspection
  };
}

export function normaliseFrozenInspectionTransport(value) {
  const frozen = assertInspectionObject(value);
  if (
    frozen.schema !== FROZEN_INSPECTION_TRANSPORT_SCHEMA ||
    frozen.type !== 'frozen_inspection_transport'
  ) {
    throw transportError(
      'FROZEN_INSPECTION_TRANSPORT_SCHEMA_INVALID',
      'The hosted assessment requires the supported frozen-inspection transport schema.'
    );
  }

  if (
    Object.hasOwn(frozen?.target || {}, 'repositoryPath') ||
    Object.hasOwn(frozen, 'repositoryPath') ||
    Object.hasOwn(frozen, 'gitRoot')
  ) {
    throw transportError(
      'FROZEN_INSPECTION_LOCAL_PATH_REJECTED',
      'Local repository paths are not accepted by hosted ARL authority.'
    );
  }

  const revision = cleanRevision(frozen?.target?.revision);
  const before = cleanRevision(frozen?.binding?.revisionBefore);
  const after = cleanRevision(frozen?.binding?.revisionAfter);
  if (
    frozen?.target?.source !== 'local_git' ||
    frozen?.target?.dirty !== false ||
    frozen?.binding?.verified !== true ||
    before !== revision ||
    after !== revision
  ) {
    throw transportError(
      'FROZEN_INSPECTION_BINDING_INVALID',
      'Hosted ARL authority accepts only a clean verified inspection bound to one Git revision.'
    );
  }

  return {
    schema: FROZEN_INSPECTION_TRANSPORT_SCHEMA,
    type: 'frozen_inspection_transport',
    target: {
      source: 'local_git',
      revision,
      dirty: false
    },
    binding: {
      verified: true,
      revisionBefore: revision,
      revisionAfter: revision
    },
    inspection: assertInspectionObject(frozen.inspection)
  };
}
