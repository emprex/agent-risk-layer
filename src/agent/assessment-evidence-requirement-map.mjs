import {extractSourceObservationFacts} from './ai/source-observation-facts.mjs';
import {db} from '../db.js';
import {verifySourceCollectionArtifact} from './tools/source-collection-artifacts.mjs';

const norm=s=>String(s||'').trim().replace(/\s+/g,' ').toLowerCase();

// Reads already-persisted bounded metadata. Never treats collected signals as proof of control effectiveness.
export async function mapAssessmentEvidenceToRequirements({inventory,projectId,snapshotId,targetRevision}) {
  if(inventory?.schema!=='arl.agent.assessment-business-content-inventory.v1' ||
     inventory.controlsTotal!==108 || inventory.controls?.length!==108 ||
     inventory.projectId!==projectId || inventory.snapshotId!==snapshotId ||
     inventory.targetRevision!==targetRevision ||
     inventory.passFailInferred!==false || inventory.evidenceAccepted!==false ||
     !/^[a-f0-9]{40}$/.test(targetRevision||'') ||
     new Set(inventory.controls.map(c=>c.controlId)).size!==108)
    throw new Error('Evidence mapping requires complete authenticated current-snapshot business inventory.');
  const snapshot=await db.prepare(
    "SELECT workspace_id,assessment_configuration_json FROM system_snapshots WHERE id=? AND project_id=? AND status='current'"
  ).get(snapshotId,projectId);
  if(!snapshot) throw new Error('Current scope unavailable.');
  const config=JSON.parse(snapshot.assessment_configuration_json||'{}');
  if(config.targetBinding?.source!=='git' || config.targetBinding.revision!==targetRevision)
    throw new Error('Frozen target scope changed.');
  const rows=await db.prepare(
    'SELECT * FROM control_source_collection_artifacts WHERE workspace_id=? AND project_id=? AND system_snapshot_id=? AND target_revision=? ORDER BY entry_id,id'
  ).all(snapshot.workspace_id,projectId,snapshotId,targetRevision);
  const byId=new Map(inventory.controls.map(c=>[c.controlId,[]]));
  for(const row of rows){
    if(!byId.has(row.entry_id)) throw new Error('Foreign control artifact in current assessment.');
    const collection=verifySourceCollectionArtifact(row,{
      workspaceId:snapshot.workspace_id,projectId,snapshotId,
      controlId:row.entry_id,targetRevision,inputReference:row.input_reference
    });
    if(!row.input_reference.startsWith('arl_frozen_source_evidence_collection_v2:'+targetRevision+':'+row.entry_id+':'))
      throw new Error('Artifact has invalid control-specific source reference.');
    if(!Array.isArray(collection.requirementObservations)) throw new Error('Artifact missing canonical observations.');
    byId.get(row.entry_id).push({digest:row.collection_sha256,observations:collection.requirementObservations});
  }
  const controls=inventory.controls.map(c=>{
    const artifacts=byId.get(c.controlId);
    const requirements=c.requiredEvidence.map((requirement,i)=>{
      const matched=artifacts.flatMap(a=>a.observations.filter(o=>norm(o.requirement)===norm(requirement))
        .map(o=>({artifactSha256:a.digest,collectors:(o.collectors||[]).filter(k=>
          Object.hasOwn(o.observations||{},k)),facts:extractSourceObservationFacts(o.observations)})));
      const distinct=[...new Set(matched.flatMap(x=>x.collectors))].sort();
      return {
        requirementIndex:i+1,requirement,
        sourceArtifactSha256:[...new Set(matched.map(m=>m.artifactSha256))],
        observedCollectorTypes:distinct,
        boundedSourceFacts:matched.flatMap(m=>m.facts.map(f=>({...f,artifactSha256:m.artifactSha256}))).slice(0,18),
        observationState:matched.length?'static_metadata_candidate':'no_exact_static_metadata_match',
        evidenceValidated:false,requirementSatisfied:false,
        nextAction:matched.length?'Human review of matching metadata and source material':
          'Obtain and review evidence or obtain separately scoped test authorisation'
      };
    });
    return {controlId:c.controlId,title:c.title,category:c.category,
      objective:c.objective,method:c.method,workflowLane:c.workflowLane,
      applicabilityStatus:c.applicabilityStatus,
      persistedStaticArtifacts:artifacts.length,requirements,
      matchedRequirementCount:requirements.filter(r=>r.observationState==='static_metadata_candidate').length,
      unmatchedRequirementCount:requirements.filter(r=>r.observationState==='no_exact_static_metadata_match').length,
      assessmentResult:'not_determined',humanReviewRequired:true};
  });
  return {schema:'arl.agent.assessment-evidence-requirement-map.v1',
    projectId,snapshotId,targetRevision,controlsTotal:108,storedArtifactCount:rows.length,
    requirementsTotal:controls.reduce((a,c)=>a+c.requirements.length,0),
    matchedRequirements:controls.reduce((a,c)=>a+c.matchedRequirementCount,0),
    unmatchedRequirements:controls.reduce((a,c)=>a+c.unmatchedRequirementCount,0),
    controls,
    note:'An exact textual requirement-to-collector match identifies candidate metadata only. It is not evidence sufficiency, a finding, a security result, or proof the requirement is satisfied.',
    securityStateChanged:false,deploymentDecisionWritten:false,evidenceAccepted:false,
    passFailInferred:false,humanReviewRequired:true};
}
