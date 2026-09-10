import {
  registerRemediationEvidenceArtifact,
  updateRemediationItem
} from '../../control-plane.js';

export async function recordAuthoritativeRemediationImplementation({
  projectId,
  userId,
  findingId,
  sourceType = 'asset_snapshot',
  sourceId
} = {}) {
  if (!projectId || !userId) {
    return {
      type: 'authoritative_remediation_implementation',
      available: false,
      reason: 'project_identity_required'
    };
  }

  if (!findingId) {
    return {
      type: 'authoritative_remediation_implementation',
      available: false,
      reason: 'finding_identity_required'
    };
  }

  if (!sourceId) {
    return {
      type: 'authoritative_remediation_implementation',
      available: false,
      reason: 'implementation_evidence_source_required',
      findingId
    };
  }

  const artifact =
    await registerRemediationEvidenceArtifact({
      projectId,
      itemId: findingId,
      userId,
      artifactType: 'implementation',
      sourceType,
      sourceId
    });

  const remediation =
    await updateRemediationItem({
      projectId,
      itemId: findingId,
      userId,
      patch: {
        status: 'evidence_attached',
        verification: {
          artifactId: artifact.id,
          changeReference: sourceId,
          limitations:
            'Implementation evidence proves that a remediation change artifact exists. A changed system snapshot and exact retest are still required before closure.'
        }
      }
    });

  return {
    type: 'authoritative_remediation_implementation',
    available: true,
    findingId,
    artifactId: artifact.id,
    artifactType: artifact.artifactType,
    sourceType: artifact.sourceType,
    sourceId: artifact.sourceId,
    digest: artifact.digest,
    remediationStatus: remediation.status,
    nextStage: 'changed_system_snapshot_required'
  };
}
