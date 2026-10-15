import {db} from '../db.js';
import {getControlIntelligenceControl} from '../control-intelligence.js';
import {verifySourceCollectionArtifact} from './tools/source-collection-artifacts.mjs';

// Read-only complete-snapshot audit. Every stored collection is digest checked,
// including historical repeats. Never promotes candidates or creates decisions.
export async function auditAssessmentStaticArtifacts({projectId,userId,snapshotId,targetRevision,queue}) {
  if (!projectId || !userId || !snapshotId || !/^[a-f0-9]{40}$/.test(targetRevision || '') ||
      !queue?.complete || queue.systemSnapshotId !== snapshotId ||
      queue.total !== 108 || queue.expectedTotal !== 108 ||
      !Array.isArray(queue.controlIds) || queue.controlIds.length !== 108 ||
      new Set(queue.controlIds).size !== 108)
    throw new Error('Integrity audit requires a complete, bound 108-control assessment.');
  const eligible=[...(queue.lanes?.test_planning||[]),...(queue.lanes?.evidence_collection||[])]
    .map(x=>x.controlId).sort();
  const excluded=queue.controlIds.filter(id=>!eligible.includes(id));
  if (eligible.length+excluded.length !== 108 || new Set(eligible).size !== eligible.length)
    throw new Error('Integrity audit scope is incomplete or contains duplicates.');
  const first=await getControlIntelligenceControl({projectId,controlId:queue.controlIds[0],userId});
  const cfg=first?.systemSnapshot?.assessmentConfiguration;
  if (first?.systemSnapshot?.id !== snapshotId ||
      cfg?.targetBinding?.source !== 'git' || cfg.targetBinding.revision !== targetRevision)
    throw new Error('Integrity audit refuses unbound snapshot or target.');
  // Authorize reads for all 108 controls using the canonical existing control authority.
  for (const controlId of queue.controlIds) {
    const detail=await getControlIntelligenceControl({projectId,controlId,userId});
    if (detail?.systemSnapshot?.id !== snapshotId ||
        detail.systemSnapshot?.assessmentConfiguration?.targetBinding?.revision !== targetRevision)
      throw new Error('Control binding changed during integrity audit: '+controlId);
  }
  const current=await db.prepare(
    "SELECT workspace_id FROM system_snapshots WHERE id=? AND project_id=? AND status='current'"
  ).get(snapshotId,projectId);
  if (!current?.workspace_id) throw new Error('Bound current snapshot is unavailable.');
  const rows=await db.prepare(
    'SELECT * FROM control_source_collection_artifacts WHERE workspace_id=? AND project_id=? AND system_snapshot_id=? AND target_revision=? ORDER BY entry_id, created_at, id'
  ).all(current.workspace_id,projectId,snapshotId,targetRevision);
  const controls=new Map(queue.controlIds.map(controlId=>[controlId,{
    controlId,lane:Object.keys(queue.lanes).find(lane=>queue.lanes[lane].some(x=>x.controlId===controlId)),
    storedArtifacts:0,integrity:'no_artifact',errors:[]
  }]));
  for (const row of rows) {
    const control=controls.get(row.entry_id);
    if (!control) throw new Error('Unexpected artifact outside canonical 108-control scope.');
    control.storedArtifacts++;
    try {
      verifySourceCollectionArtifact(row,{
        workspaceId:current.workspace_id,projectId,snapshotId,
        controlId:row.entry_id,targetRevision,inputReference:row.input_reference
      });
      if (!row.input_reference.startsWith(
        'arl_frozen_source_evidence_collection_v2:'+targetRevision+':'+row.entry_id+':'))
        throw new Error('Artifact source reference lacks exact control and frozen target binding.');
      if (control.integrity !== 'failed') control.integrity='verified_artifact_integrity_only';
    } catch (error) {
      control.integrity='failed';
      control.errors.push({artifactId:row.id,reason:String(error.message).slice(0,180)});
    }
  }
  const list=[...controls.values()];
  const missing=eligible.filter(id=>controls.get(id).storedArtifacts===0);
  const failed=list.filter(c=>c.integrity==='failed').map(c=>c.controlId);
  return {
    schema:'arl.agent.assessment-static-integrity-audit.v1',
    projectId,snapshotId,targetRevision,
    controlsTotal:108,eligibleControls:eligible.length,
    excludedControls:excluded.map(id=>({controlId:id,lane:controls.get(id).lane,
      storedArtifacts:controls.get(id).storedArtifacts})),
    storedArtifactCount:rows.length,
    eligibleWithArtifacts:eligible.length-missing.length,
    eligibleMissingArtifacts:missing,
    controlsWithIntegrityFailures:failed,
    artifactIntegrityVerified:failed.length===0 && missing.length===0,
    controls:list,
    disclaimer:'Artifact integrity and binding only; evidence validity, applicability, security outcome and deployment remain human decisions.',
    securityStateChanged:false,deploymentDecisionWritten:false,
    testsExecuted:0,evidenceAccepted:false,passFailInferred:false,humanReviewRequired:true
  };
}
