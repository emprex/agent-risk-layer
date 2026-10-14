import crypto from 'node:crypto';
import { db } from '../../db.js';
import { getControlIntelligenceControl } from '../../control-intelligence.js';

const SHA40 = /^[a-f0-9]{40}$/;
const SHA256 = /^[a-f0-9]{64}$/;

export function serializeSourceCollection(collection, { targetRevision, projectionDigest } = {}) {
  if (!SHA40.test(targetRevision || '') || collection?.targetRevision !== targetRevision ||
      collection?.schema !== 'arl.deterministic-evidence-collection.v1' ||
      typeof collection?.privacyBoundary !== 'string' ||
      !collection.privacyBoundary.includes('No source code, secret values')) {
    throw new Error('Complete collection requires a privacy-bounded exact frozen-source identity.');
  }
  const json = JSON.stringify(collection);
  const digest = crypto.createHash('sha256').update(json).digest('hex');
  if (projectionDigest != null && (!SHA256.test(projectionDigest) || projectionDigest !== digest)) {
    throw new Error('Complete collection digest does not match bounded projection.');
  }
  return { json, digest };
}

export function verifySourceCollectionArtifact(row, scope) {
  if (!row || !scope || !SHA40.test(scope.targetRevision || '') ||
      !SHA256.test(row.collection_sha256 || '') ||
      row.workspace_id !== scope.workspaceId ||
      row.project_id !== scope.projectId ||
      row.system_snapshot_id !== scope.snapshotId ||
      row.entry_id !== scope.controlId ||
      row.target_revision !== scope.targetRevision ||
      row.input_reference !== scope.inputReference) {
    throw new Error('Full collection artifact is missing or outside exact assessment scope.');
  }
  if (!['active','retained_hold'].includes(row.retention_status)) throw new Error('Full collection artifact is not retained for use.');
  if (row.retention_status !== 'retained_hold' && row.retention_expires_at && Date.parse(row.retention_expires_at) <= Date.now()) {
    throw new Error('Full collection artifact retention has expired.');
  }
  const digest = crypto.createHash('sha256').update(row.collection_json).digest('hex');
  if (digest !== row.collection_sha256) throw new Error('Full collection artifact integrity mismatch.');
  const parsed = JSON.parse(row.collection_json);
  serializeSourceCollection(parsed, {targetRevision:scope.targetRevision,projectionDigest:digest});
  return parsed;
}

// Internal-only read; require the same authenticated control access as the dossier.
// Deliberately no public URL or API route for full artifacts.
export async function readSourceCollectionArtifact(scope, userId) {
  if (!userId) throw new Error('Authenticated evidence reader required.');
  const detail = await getControlIntelligenceControl({
    projectId:scope.projectId,controlId:scope.controlId,userId
  });
  if (detail.systemSnapshot?.id !== scope.snapshotId ||
      detail.systemSnapshot?.assessmentConfiguration?.targetBinding?.revision !== scope.targetRevision) {
    throw new Error('Full collection access requires matching current assessment scope.');
  }
  const row = await db.prepare(
    'SELECT * FROM control_source_collection_artifacts WHERE workspace_id=? AND project_id=? AND system_snapshot_id=? AND entry_id=? AND target_revision=? AND input_reference=?'
  ).get(scope.workspaceId,scope.projectId,scope.snapshotId,scope.controlId,scope.targetRevision,scope.inputReference);
  return verifySourceCollectionArtifact(row,scope);
}

// Called only after getControlIntelligenceControl has authorised the operator.
// Never treats source collection as verified test evidence.
export async function storeSourceCollectionArtifact({projectId,snapshotId,controlId,targetRevision,inputReference,collection,projectionDigest}) {
  const {json,digest} = serializeSourceCollection(collection,{targetRevision,projectionDigest});
  const current = await db.prepare(
    "SELECT s.workspace_id, s.assessment_configuration_json FROM system_snapshots s JOIN security_projects p ON p.id=s.project_id AND p.workspace_id=s.workspace_id WHERE s.project_id=? AND s.id=? AND s.status='current'"
  ).get(projectId,snapshotId);
  if (!current) throw new Error('Current assessment snapshot is required for collection persistence.');
  const configuration = JSON.parse(current.assessment_configuration_json || '{}');
  if (configuration.targetBinding?.source !== 'git' ||
      configuration.targetBinding.revision !== targetRevision ||
      !String(inputReference).startsWith('arl_frozen_source_evidence_collection_v2:'+targetRevision+':'+controlId+':')) {
    throw new Error('Complete collection must match the exact frozen Git target and source reference.');
  }
  const scope={workspaceId:current.workspace_id,projectId,snapshotId,controlId,targetRevision,inputReference};
  const id='sca_'+crypto.createHash('sha256').update(JSON.stringify(scope)).digest('hex');
  await db.prepare(
    'INSERT INTO control_source_collection_artifacts (id,workspace_id,project_id,system_snapshot_id,entry_id,target_revision,input_reference,collection_sha256,collection_json,collector_schema,created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT DO NOTHING'
  ).run(id,scope.workspaceId,projectId,snapshotId,controlId,targetRevision,inputReference,digest,json,collection.schema,new Date().toISOString());
  const row=await db.prepare('SELECT * FROM control_source_collection_artifacts WHERE id=?').get(id);
  verifySourceCollectionArtifact(row,scope);
  if (row.collection_sha256 !== digest) throw new Error('Existing artifact does not match repeated collection.');
  return {id,digest};
}
