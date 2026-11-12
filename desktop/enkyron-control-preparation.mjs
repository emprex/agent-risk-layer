// One bounded read-only preparation pass for all 108 existing ARL controls.
// Requirements are copied from the canonical PostgreSQL check definitions,
// classified using ARL's reviewed requirement router. Source Inspector findings
// are intentionally NOT assigned to controls by keyword or model inference.
import crypto from 'node:crypto';
import {readLinkedAssessmentContext} from './enkyron-ticket-assessment.mjs';
import {buildCanonicalEvidenceRequirementPlan}
  from '../src/agent/canonical-evidence-requirement-plan.mjs';

const ID=/^ARL-KB-(?:00[1-9]|0[1-9][0-9]|10[0-8])$/;
const UUID=/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i;
const clean=(value,max=1000)=>String(value??'').trim().slice(0,max);

function refusal(message){throw new Error('Control preparation: '+message);}
function evidenceArray(value) {
  let result=value;
  if(typeof value==='string') {
    try {result=JSON.parse(value);} catch {refusal('canonical evidence JSON is malformed');}
  }
  if(!Array.isArray(result) || result.length>40 ||
     result.some(x=>typeof x!=='string'||!x.trim()||x.length>2000))
    refusal('unexpected canonical evidence requirements');
  return result;
}

export function shapeControlPreparation({scope,rows,items}){
  if(!scope?.project_id || !scope?.snapshot_id || !/^[a-f0-9]{40}$/.test(scope?.target_sha||'') ||
     !Array.isArray(rows)||rows.length!==108||
     !Array.isArray(items)||items.length!==108)
    refusal('complete canonical snapshot and exactly 108 controls required');
  const workflow=new Map();
  for(const item of items){
    if(!ID.test(item?.control_id||'')||workflow.has(item.control_id))
      refusal('duplicate or unknown canonical workflow identity');
    workflow.set(item.control_id,item);
  }
  const seen=new Set();
  const dossiers=[];
  for(const row of rows) {
    const controlId=row.control_id;
    if(!ID.test(controlId||'')||seen.has(controlId)||!workflow.has(controlId))
      refusal('missing, duplicated or out-of-scope control definition');
    seen.add(controlId);
    const required=evidenceArray(row.required_evidence_json);
    const planned=buildCanonicalEvidenceRequirementPlan(required);
    const modeCounts={source_candidates:0,owner_documents:0,authorised_runtime:0};
    const criteria=planned.map((p,index)=>{
      if(p.mode==='machine_collectable')modeCounts.source_candidates++;
      else if(p.mode==='active_test_or_runtime')modeCounts.authorised_runtime++;
      else modeCounts.owner_documents++;
      return {
        number:index+1,
        requirement:clean(p.requirement,2000),
        route:p.mode,
        collectors:p.mode==='machine_collectable'
          ? [...p.collectors].map(c=>clean(c,100)):[],
        source_verified:false,
        evidence_accepted:false,
        test_authorised:false,
      };
    });
    const stage=workflow.get(controlId).stage;
    dossiers.push({
      control_id:controlId,
      title:clean(row.title,250),
      category:clean(row.category,150),
      stage,
      check_objective:clean(row.objective,1600),
      check_method:clean(row.method,1600),
      required_evidence:criteria,
      counts:modeCounts,
      check_digest:clean(row.check_digest,100),
      knowledge_digest:clean(row.knowledge_digest,100),
      human_review_required:true,
      prepared_decision:null,
      evidence_verified:false,
      next_step:stage==='applicability'
        ? 'Confirm the agent purpose, real architecture and permissions before deciding applicability.'
        : clean(workflow.get(controlId).next_action,450)
    });
  }
  dossiers.sort((a,b)=>a.control_id.localeCompare(b.control_id));
  if(seen.size!==108 ||
     dossiers.some((row,i)=>row.control_id!=='ARL-KB-'+String(i+1).padStart(3,'0')))
    refusal('canonical registry is incomplete or out of order');
  const totals=dossiers.reduce((acc,d)=>{
    for(const key of Object.keys(acc))acc[key]+=d.counts[key];
    return acc;
  },{source_candidates:0,owner_documents:0,authorised_runtime:0});
  return {
    available:true,
    schema:'enkyron.control-preparation.v1',
    project_id:scope.project_id,
    snapshot_id:scope.snapshot_id,
    target_sha:scope.target_sha,
    controls_total:108,
    criterion_routes:totals,
    dossiers,
    security_state_changed:false,
    decisions_recorded:0,
    tests_executed:0,
    human_review_required:true,
    notice:'Draft work packages from canonical ARL check definitions. Source routes are candidate collection METHODS, not observed evidence. No applicability, PASS/FAIL, test permission or evidence acceptance inferred.'
  };
}

export async function prepareTicketControlDossiers(pool,ticketId,{
  scopeReader=readLinkedAssessmentContext,
  queueReader=null
}={}){
  if(typeof ticketId!=='string'||!UUID.test(ticketId))
    refusal('exact linked ticket required');
  const scope=await scopeReader(pool,ticketId);
  const {readTicketControlQueue}=await import('./enkyron-ticket-controls.mjs');
  const queue=await (queueReader||readTicketControlQueue)(pool,ticketId);
  if(queue?.total!==108||queue?.snapshot_id!==scope.snapshot_id||
     queue?.project_id!==scope.project_id||queue?.target_sha!==scope.target_sha)
    refusal('canonical workflow queue is not bound to the current ticket snapshot');
  // Only existing, already-evaluated KB controls are joined. No synthetic
  // check definition, inferred rule mapping, or assessment record is inserted.
  const result=await pool.query(`
    SELECT c.entry_id AS control_id,e.title,e.category,
           e.content_digest AS knowledge_digest,
           k.objective,k.method,k.required_evidence_json,
           k.content_digest AS check_digest
    FROM control_snapshot_evaluations c
    JOIN risk_knowledge_entries e ON e.id=c.entry_id
    LEFT JOIN LATERAL (
      SELECT objective,method,required_evidence_json,content_digest
      FROM risk_knowledge_checks
      WHERE entry_id=c.entry_id ORDER BY id LIMIT 1
    ) k ON TRUE
    WHERE c.project_id=$1 AND c.system_snapshot_id=$2
    ORDER BY c.entry_id
  `,[scope.project_id,scope.snapshot_id]);
  const rows=result?.rows;
  const proposal=shapeControlPreparation({scope,rows,items:queue.items});
  const after=await scopeReader(pool,ticketId);
  if(after.snapshot_id!==scope.snapshot_id ||
     after.target_sha!==scope.target_sha ||
     after.project_id!==scope.project_id)
    refusal('assessment changed during preparation; reopen the ticket');
  return {...proposal,ticket_id:ticketId};
}

/**
 * The dialog gets a complete queue + preparation in ONE IPC request.
 * This avoids reopening 108 control details just to discover the required
 * evidence and avoids a duplicate operator button for batch preparation.
 */
export async function readPreparedTicketControlQueue(pool,ticketId,{
  queueReader=null,
  scopeReader=readLinkedAssessmentContext
}={}){
  const {readTicketControlQueue}=await import('./enkyron-ticket-controls.mjs');
  const queue=await (queueReader||readTicketControlQueue)(pool,ticketId);
  const preparation=await prepareTicketControlDossiers(pool,ticketId,{
    scopeReader,queueReader:async()=>queue
  });
  return {...queue,preparation};
}


/**
 * One explicit read-only candidate projection for the existing 108-control
 * workplan. This is intentionally NOT canonical evidence persistence, test
 * execution, evidence acceptance or an applicability decision.
 */
export function shapeTicketStaticCandidatePreview({scope,preparation,frozen,collection}={}) {
  if (!scope?.project_id || !scope?.assessment_id || !scope?.snapshot_id ||
      !/^[a-f0-9]{40}$/.test(scope.target_sha || '') ||
      preparation?.ticket_id == null || preparation?.controls_total !== 108 ||
      preparation.project_id !== scope.project_id ||
      preparation.snapshot_id !== scope.snapshot_id ||
      preparation.target_sha !== scope.target_sha ||
      !Array.isArray(preparation.dossiers) || preparation.dossiers.length !== 108 ||
      frozen?.type !== 'frozen_inspection' ||
      frozen?.binding?.verified !== true ||
      frozen?.target?.dirty !== false ||
      frozen?.target?.revision !== scope.target_sha ||
      frozen?.target?.repositoryPath !== scope.target_reference ||
      frozen?.binding?.revisionBefore !== scope.target_sha ||
      frozen?.binding?.revisionAfter !== scope.target_sha ||
      frozen?.inspection?.schema !== 'arl.inspection.bundle.v1' ||
      frozen?.inspection?.scope?.mode !== 'read-only-static-inspection' ||
      collection?.schema !== 'arl.deterministic-evidence-collection.v1' ||
      collection?.targetRevision !== scope.target_sha ||
      !Array.isArray(collection.requirementObservations)) {
    refusal('static candidate collection is not bound to the exact clean assessment snapshot');
  }
  const requirements=new Map();
  const tasks=[];
  for (const dossier of preparation.dossiers) {
    if (!ID.test(dossier?.control_id || '') || !Array.isArray(dossier.required_evidence)) {
      refusal('malformed canonical control preparation');
    }
    for (const criterion of dossier.required_evidence) {
      if (criterion.route !== 'machine_collectable') continue;
      const requirement=String(criterion.requirement || '').trim();
      if (!requirement || !Array.isArray(criterion.collectors) ||
          !criterion.collectors.length || !Number.isSafeInteger(criterion.number) ||
          criterion.number < 1) refusal('invalid machine-collectable requirement');
      requirements.set(requirement,true);
      tasks.push({control_id:dossier.control_id,criterion_number:criterion.number,
        requirement,expected_collectors:[...criterion.collectors]});
    }
  }
  if (tasks.length > 3000) refusal('static collection exceeds bounded workplan');
  const observations=new Map();
  for (const record of collection.requirementObservations) {
    const requirement=String(record?.requirement || '').trim();
    if (!requirements.has(requirement) || observations.has(requirement) ||
        !Array.isArray(record?.collectors) ||
        !record.observations || typeof record.observations !== 'object' ||
        Array.isArray(record.observations)) {
      refusal('unexpected or duplicated deterministic observation');
    }
    observations.set(requirement,record);
  }
  // Do not silently count missing requirements as successful collector runs.
  if (observations.size !== requirements.size) refusal('incomplete deterministic collection');
  const criteria=tasks.map(task=>{
    const source=observations.get(task.requirement);
    const reported=task.expected_collectors.filter(name=>
      source.collectors.includes(name) &&
      Object.hasOwn(source.observations,name));
    return {
      control_id:task.control_id,
      criterion_number:task.criterion_number,
      expected_collectors:task.expected_collectors,
      projected_collectors:reported,
      state:reported.length===task.expected_collectors.length
        ? 'static_metadata_projected_unverified'
        : 'static_metadata_incomplete',
      projection_sha256:crypto.createHash('sha256')
        .update(JSON.stringify(source)).digest('hex'),
      evidence_accepted:false,
      criterion_satisfied:false
    };
  });
  return {
    available:true,
    schema:'enkyron.static-candidate-preview.v1',
    ticket_id:preparation.ticket_id,
    project_id:scope.project_id,
    assessment_id:scope.assessment_id,
    snapshot_id:scope.snapshot_id,
    target_sha:scope.target_sha,
    controls_total:108,
    static_criteria:criteria.length,
    distinct_requirements:requirements.size,
    metadata_projections:criteria.filter(x=>
      x.state==='static_metadata_projected_unverified').length,
    incomplete_projections:criteria.filter(x=>
      x.state==='static_metadata_incomplete').length,
    inspector_files: Number.isSafeInteger(frozen.inspection.scope.filesInspected)
      ? frozen.inspection.scope.filesInspected : null,
    inspector_truncated:frozen.inspection.scope.truncatedByLimit===true,
    collection_sha256:crypto.createHash('sha256')
      .update(JSON.stringify(collection)).digest('hex'),
    criteria,
    evidence_persisted:0,
    evidence_accepted:false,
    tests_executed:0,
    decisions_recorded:0,
    active_tests_authorised:false,
    human_review_required:true,
    notice:'Read-only deterministic SOURCE METADATA preview, not stored canonical evidence. Projected metadata is not proof that a criterion is satisfied. Review and explicit evidence recording are separate steps.'
  };
}

export async function collectTicketStaticCandidates(pool,ticketId,{
  scopeReader=readLinkedAssessmentContext,
  preparationReader=prepareTicketControlDossiers,
  inspector=null,
  collector=null,
  freezeReader=null
}={}) {
  if (typeof ticketId !== 'string' || !UUID.test(ticketId))
    refusal('exact linked ticket required for static collection');
  const scope=await scopeReader(pool,ticketId);
  const preparation=await preparationReader(pool,ticketId,{scopeReader});
  if (preparation?.ticket_id !== ticketId ||
      preparation?.project_id !== scope.project_id ||
      preparation?.snapshot_id !== scope.snapshot_id ||
      preparation?.target_sha !== scope.target_sha)
    refusal('control workplan changed before source collection');
  const {inspectFrozenRepository}=await import('../src/agent/tools/inspect-frozen-repository.mjs');
  const frozen=await (inspector || inspectFrozenRepository)(scope.target_reference);
  // Validate before collection; never trust the collector's own fallback SHA.
  if (frozen?.binding?.verified !== true ||
      frozen?.target?.revision !== scope.target_sha ||
      frozen?.target?.dirty !== false ||
      frozen?.target?.repositoryPath !== scope.target_reference ||
      frozen?.binding?.revisionBefore !== scope.target_sha ||
      frozen?.binding?.revisionAfter !== scope.target_sha ||
      frozen?.inspection?.schema !== 'arl.inspection.bundle.v1' ||
      frozen?.inspection?.scope?.mode !== 'read-only-static-inspection')
    refusal('frozen Inspector does not match the exact clean target');
  const requirements=[...new Set(preparation.dossiers.flatMap(dossier=>
    (dossier.required_evidence || [])
      .filter(c=>c.route==='machine_collectable')
      .map(c=>String(c.requirement || '').trim())))];
  const {collectDeterministicEvidence}=await import('../src/agent/deterministic-evidence-collector.mjs');
  const collection=(collector || collectDeterministicEvidence)({
    repositoryPath:scope.target_reference,frozen,requirements
  });
  const {freezeLocalRepository}=await import('../src/agent/tools/freeze-local-repository.mjs');
  const after=await (freezeReader || freezeLocalRepository)(scope.target_reference);
  if (after.dirty || after.revision !== scope.target_sha ||
      after.repositoryPath !== scope.target_reference)
    refusal('frozen Git target changed during static collection');
  const current=await scopeReader(pool,ticketId);
  if (current.project_id !== scope.project_id ||
      current.assessment_id !== scope.assessment_id ||
      current.snapshot_id !== scope.snapshot_id ||
      current.target_sha !== scope.target_sha ||
      current.target_reference !== scope.target_reference)
    refusal('canonical assessment changed during static collection');
  const preview=shapeTicketStaticCandidatePreview({scope,preparation,frozen,collection});
  // Pilot handoff: expose ONLY the bounded, privacy-safe target-identity
  // metadata for canonical KB-001 requirement 1. It is not source content,
  // approved environment documentation, or evidence acceptance.
  const kb001=preparation.dossiers.find(d=>d.control_id==='ARL-KB-001');
  const criterion=kb001?.required_evidence?.find(c=>c.number===1);
  if(criterion?.route!=='machine_collectable' ||
     !criterion.collectors.includes('target_identity'))
    return preview; // Noncanonical test fixtures still get the generic preview.
  const source=collection.requirementObservations.find(
    entry=>entry.requirement===criterion.requirement);
  const identity=source?.observations?.target_identity;
  const projected=preview.criteria.find(c=>
    c.control_id==='ARL-KB-001' && c.criterion_number===1);
  if(!projected || !identity || identity.revision!==scope.target_sha ||
     !source.collectors.includes('target_identity'))
    refusal('KB-001 frozen system identity metadata is missing or has drifted');
  return {...preview,kb001_candidate:{
    schema:'enkyron.kb001.static-identity-candidate.v1',
    control_id:'ARL-KB-001',
    criterion_number:1,
    requirement:criterion.requirement,
    projection_sha256:projected.projection_sha256,
    collection_sha256:preview.collection_sha256,
    target_sha:scope.target_sha,
    snapshot_id:scope.snapshot_id,
    collector:'target_identity',
    observed_revision:identity.revision,
    observed_environment:typeof identity.environment==='string'
      ? clean(identity.environment,100):null,
    observed_project_label:typeof identity.projectName==='string'
      ? clean(identity.projectName,120):null,
    metadata_only:true,
    verified:false,
    criterion_satisfied:false,
    requires_human_recording:true,
    limitations:'A frozen Git SHA does not establish approved deployment environment, business purpose, authorised tools or governance.'
  }};
}
