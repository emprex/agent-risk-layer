// Human-authorised, resumable batch recording of deterministic *metadata*
// candidates for the other KBs. No control verdict, applicability change,
// human evidence verification, source authentication, test or Master revision.
// KB-001 keeps its existing individual canonical record, without duplication.
import crypto from 'node:crypto';
import {readLinkedAssessmentContext} from './enkyron-ticket-assessment.mjs';
import {collectTicketStaticCandidates} from './enkyron-control-preparation.mjs';
import {readKb001VerifiedMaster} from './enkyron-static-evidence-handoff.mjs';
import {canonicalControlBinding} from './enkyron-ticket-controls.mjs';

const TICKET=/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i;
const KB=/^ARL-KB-(?:00[1-9]|0[1-9]\d|10[0-8])$/;
const SHA40=/^[a-f0-9]{40}$/;
const SHA256=/^[a-f0-9]{64}$/;
const SNAP=/^sys_[A-Za-z0-9_-]{8,100}$/;
const SOURCE_TYPE='arl_static_projection_bundle';
const ACK='I AUTHORISE UNVERIFIED STATIC METADATA RECORDING ONLY';
const CHUNK=16;
const refuse=msg=>{throw new Error('Batch metadata evidence: '+msg);};
const digest=value=>crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');

export function planStaticMetadataBatch(preview) {
  if(preview?.available!==true||preview.controls_total!==108||
     !TICKET.test(preview.ticket_id||'')||
     !SNAP.test(preview.snapshot_id||'')||
     !SHA40.test(preview.target_sha||'')||
     !SHA256.test(preview.collection_sha256||'')||
     preview.evidence_persisted!==0 || preview.evidence_accepted!==false ||
     preview.tests_executed!==0 || !Array.isArray(preview.criteria) ||
     !Array.isArray(preview.review_workplan)||
     preview.review_workplan.length!==108)
    refuse('verified 108-control static source preparation required');
  const mapped=new Map();
  for(let n=1;n<=108;n++)mapped.set('ARL-KB-'+String(n).padStart(3,'0'),[]);
  const seen=new Set();
  for(const c of preview.criteria) {
    if(!mapped.has(c?.control_id) ||
       !Number.isSafeInteger(c.criterion_number)||
       c.criterion_number<1||c.criterion_number>40||
       c.state!=='static_metadata_projected_unverified'||
       !SHA256.test(c.projection_sha256||'')||
       !Array.isArray(c.expected_collectors)||
       !Array.isArray(c.projected_collectors)||
       c.expected_collectors.length<1||
       JSON.stringify(c.expected_collectors)!==JSON.stringify(c.projected_collectors))
      refuse('incomplete or malformed static source projection; no write');
    const key=c.control_id+':'+c.criterion_number;
    if(seen.has(key))refuse('duplicated static criterion');
    seen.add(key);
    mapped.get(c.control_id).push({
      criterion_number:c.criterion_number,
      projection_sha256:c.projection_sha256,
      collectors:[...c.expected_collectors]
    });
  }
  if(preview.criteria.length!==seen.size||seen.size===0)refuse('no unique static evidence candidates');
  const controls=[];
  const workSeen=new Set();
  for(const w of preview.review_workplan){
    if(!mapped.has(w?.control_id)||workSeen.has(w.control_id) ||
       !Number.isSafeInteger(w.source_requirements)||
       !Number.isSafeInteger(w.human_document_requirements)||
       !Number.isSafeInteger(w.authorised_runtime_requirements) ||
       mapped.get(w.control_id).length!==w.source_requirements)
      refuse('source requirement count disagrees with canonical workplan');
    workSeen.add(w.control_id);
  }
  if(workSeen.size!==108)refuse('incomplete canonical workplan');
  for(const [control_id,criteria] of mapped){
    if(!criteria.length || control_id==='ARL-KB-001')continue;
    criteria.sort((a,b)=>a.criterion_number-b.criterion_number);
    const fingerprint=digest({
      schema:'arl.static-metadata-bundle.v1',control_id,
      snapshot_id:preview.snapshot_id,target_sha:preview.target_sha,
      collection_sha256:preview.collection_sha256,criteria
    });
    const source_reference='frozen-git:'+preview.target_sha+':'+
      control_id+':static-bundle:'+fingerprint;
    controls.push({control_id,requirements:criteria.length,
      fingerprint,source_reference,criteria});
  }
  // KB-001 is deliberately excluded: its immutable existing per-requirement
  // evidence remains the only recorded source candidate for that control.
  if(mapped.get('ARL-KB-001').length!==1)
    refuse('unexpected KB-001 source plan; reconcile existing evidence before batch');
  const manifest_digest=digest({
    schema:'enkyron.static-metadata-batch.v1',
    project_id:preview.project_id,assessment_id:preview.assessment_id,
    ticket_id:preview.ticket_id,snapshot_id:preview.snapshot_id,
    target_sha:preview.target_sha,collection_sha256:preview.collection_sha256,
    bundles:controls.map(c=>[c.control_id,c.fingerprint])
  });
  return {ticket_id:preview.ticket_id,project_id:preview.project_id,
    assessment_id:preview.assessment_id,snapshot_id:preview.snapshot_id,
    target_sha:preview.target_sha,collection_sha256:preview.collection_sha256,
    manifest_digest,source_controls:controls.length+1,
    no_source_controls:108-controls.length-1,bundles:controls,
    total_requirements:preview.criteria.length};
}

export function validateStaticMetadataBatchCommit(input){
  if(!input||typeof input!=='object'||Array.isArray(input) ||
     !TICKET.test(input.ticket_id||'') || !SNAP.test(input.snapshot_id||'') ||
     !SHA40.test(input.target_sha||'') ||
     !SHA256.test(input.collection_sha256||'') ||
     !SHA256.test(input.manifest_digest||'') ||
     input.confirmed!==true || input.acknowledgement!==ACK ||
     typeof input.rationale!=='string' ||
     input.rationale.trim().length<30||input.rationale.length>350 ||
     /[\u0000-\u001f\u007f]/.test(input.rationale) ||
     !Number.isSafeInteger(input.cursor) || input.cursor<0 || input.cursor>108)
    refuse('exact bundle digest, snapshot and one explicit human authorisation required');
  return {ticket_id:input.ticket_id,rationale:input.rationale.trim(),cursor:input.cursor};
}

function checkedScope(expected,scope) {
  if(!scope||expected.project_id!==scope.project_id||
     expected.assessment_id!==scope.assessment_id||
     expected.snapshot_id!==scope.snapshot_id ||
     expected.target_sha!==scope.target_sha ||
     !scope.target_reference)
    refuse('assessment scope or frozen source changed');
}

function validateExisting(rows,plan) {
  const expected=new Map(plan.bundles.map(c=>[c.control_id,c.source_reference]));
  const byControl=new Map();
  for(const row of rows){
    const desired=expected.get(row?.entry_id);
    if(!desired || byControl.has(row.entry_id) ||
       row.source_reference!==desired ||
       row.retention_status!=='active' ||
       row.verification_state!=='unverified' ||
       !/^cei_[a-f0-9]{32}$/.test(row.id||''))
      refuse('existing source bundle differs, duplicates or changes trust state; reconcile manually');
    byControl.set(row.entry_id,row.id);
  }
  return byControl;
}

async function readExisting(client,plan){
  const result=await client.query(
    'SELECT id,entry_id,source_reference,verification_state,retention_status '+
    'FROM control_evidence_items WHERE project_id=$1 AND system_snapshot_id=$2 '+
    'AND source_type=$3 ORDER BY entry_id,id',
    [plan.project_id,plan.snapshot_id,SOURCE_TYPE]);
  return validateExisting(result.rows||[],plan);
}

export function staticMetadataBatchLimitations(bundle,plan,rationale) {
  const criteria=bundle.criteria.map(c=>
    c.criterion_number+':'+c.projection_sha256).join(', ');
  const text=[
    'UNVERIFIED DETERMINISTIC SOURCE METADATA CANDIDATE, NOT ACCEPTED PROOF',
    'Frozen Git SHA: '+plan.target_sha,
    'Static collection SHA256: '+plan.collection_sha256,
    'Manifest SHA256: '+plan.manifest_digest,
    'Control bundle SHA256: '+bundle.fingerprint,
    'Criterion projections: '+criteria,
    'Metadata collectors and source observations require independent review.',
    'No approved purpose, operational environment, permissions, active tests or PASS.',
    'Human authorisation to RECORD metadata only: '+rationale
  ].join(' | ');
  if(text.length>2000)refuse('bounded source metadata bundle limitations exceeded');
  return text;
}

async function prepare(pool,ticketId,{collect,scopeReader,masterReader}){
  if(!TICKET.test(ticketId||''))refuse('exact ticket required');
  const scope=await scopeReader(pool,ticketId);
  const preview=await collect(pool,ticketId);
  const plan=planStaticMetadataBatch(preview);
  checkedScope(plan,scope);
  await masterReader(pool,scope);
  return {scope,plan};
}

export async function previewStaticMetadataBatch(pool,ticketId,{
  collect=collectTicketStaticCandidates,
  scopeReader=readLinkedAssessmentContext,
  masterReader=readKb001VerifiedMaster
}={}){
  const {plan}=await prepare(pool,ticketId,{collect,scopeReader,masterReader});
  const client=await pool.connect();
  try{
    await client.query('BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY');
    const existing=await readExisting(client,plan);
    await client.query('COMMIT');
    return {available:true,schema:'enkyron.static-batch-preview.v1',
      ticket_id:ticketId,project_id:plan.project_id,
      assessment_id:plan.assessment_id,snapshot_id:plan.snapshot_id,
      target_sha:plan.target_sha,collection_sha256:plan.collection_sha256,
      manifest_digest:plan.manifest_digest,controls_total:108,
      machine_source_controls:plan.source_controls,
      excluded_existing_kb001:1,controls_without_source:plan.no_source_controls,
      candidate_control_bundles:plan.bundles.length,
      candidate_criteria_total:plan.total_requirements-1,
      already_recorded:existing.size,to_record:plan.bundles.length-existing.size,
      chunk_size:CHUNK,requires_explicit_human_authorisation:true,
      verification_state:'unverified',evidence_accepted:false,master_modified:false,
      active_tests_executed:0,
      notice:'Candidate metadata records ONLY. One accountable human authorisation starts resumable writes in bounded chunks; no control PASS/FAIL, evidence acceptance or source authentication.'};
  }catch(e){await client.query('ROLLBACK').catch(()=>{});throw e;}
  finally{client.release();}
}

export async function recordStaticMetadataBatchChunk(pool,input,actor,{
  collect=collectTicketStaticCandidates,
  scopeReader=readLinkedAssessmentContext,
  masterReader=readKb001VerifiedMaster,
  bindingReader=canonicalControlBinding,
  writer=null
}={}){
  const request=validateStaticMetadataBatchCommit(input);
  if(typeof actor!=='string'||!actor)refuse('accountable operator required');
  const owner=(await pool.query(
    'SELECT assigned_to,assessor_name,status,archived_at FROM arl_workbench_tickets WHERE id=$1',
    [request.ticket_id])).rows[0];
  if(!owner||owner.archived_at||owner.status==='closed'||
     owner.assigned_to!==actor||owner.assessor_name!==actor)
    refuse('original accountable active ticket operator required');
  const {scope,plan}=await prepare(pool,request.ticket_id,{
    collect,scopeReader,masterReader});
  if(plan.snapshot_id!==input.snapshot_id||
     plan.target_sha!==input.target_sha||
     plan.collection_sha256!==input.collection_sha256||
     plan.manifest_digest!==input.manifest_digest)
    refuse('stale preview; source manifest differs before any write');
  const binding=await bindingReader(pool,request.ticket_id);
  checkedScope(plan,binding.scope);
  if(binding.binding?.projectId!==plan.project_id ||
     binding.binding?.assessmentId!==plan.assessment_id ||
     !binding.binding?.userId)
    refuse('canonical access binding mismatch');
  if(request.cursor>plan.bundles.length)refuse('cursor exceeds canonical manifest');
  const client=await pool.connect();
  let locked=false;
  try{
    await client.query('SELECT pg_advisory_lock(hashtext($1),hashtext($2))',
      [plan.project_id,plan.snapshot_id+':static-batch']);
    locked=true;
    // The desktop pg pool has max: 1. Reuse its leased advisory-lock client
    // for all guarded rechecks; pool.query here deadlocks waiting for itself.
    const current=await scopeReader(client,request.ticket_id);
    checkedScope(plan,current);
    if(current.target_reference!==scope.target_reference)
      refuse('frozen source reference changed');
    await masterReader(client,current);
    // Detect ALL existing clashes before entering even the first write.
    const existing=await readExisting(client,plan);
    const end=Math.min(plan.bundles.length,request.cursor+CHUNK);
    let created=0,skipped=0;
    const write=writer || (await import('../src/control-intelligence.js')).recordControlEvidence;
    for(let index=request.cursor;index<end;index++){
      const bundle=plan.bundles[index];
      if(existing.has(bundle.control_id)){skipped++;continue;}
      // Current Master and snapshot are reassessed before each independently
      // committed canonical ARL write; a changed SHA cannot reuse older proof.
      const ongoing=await scopeReader(client,request.ticket_id);
      checkedScope(plan,ongoing);
      if(ongoing.target_reference!==scope.target_reference)
        refuse('source path changed during batch');
      await masterReader(client,ongoing);
      const evidence=await write({
        projectId:plan.project_id,controlId:bundle.control_id,
        userId:binding.binding.userId,
        input:{
          systemSnapshotId:plan.snapshot_id,evidenceClass:'observed',
          sourceType:SOURCE_TYPE,sourceReference:bundle.source_reference,
          limitations:staticMetadataBatchLimitations(bundle,plan,request.rationale)
        }
      });
      if(!/^cei_[a-f0-9]{32}$/.test(evidence?.id||'') ||
         evidence.controlId!==bundle.control_id||
         evidence.systemSnapshotId!==plan.snapshot_id||
         evidence.sourceReference!==bundle.source_reference||
         evidence.sourceType!==SOURCE_TYPE||
         evidence.verificationState!=='unverified')
        refuse('unexpected canonical writer result; inspect register before retry');
      const verify=(await client.query(
        'SELECT id,verification_state,retention_status FROM control_evidence_items '+
        'WHERE id=$1 AND project_id=$2 AND system_snapshot_id=$3 '+
        'AND entry_id=$4 AND source_type=$5 AND source_reference=$6',
        [evidence.id,plan.project_id,plan.snapshot_id,bundle.control_id,
         SOURCE_TYPE,bundle.source_reference])).rows;
      if(verify.length!==1||verify[0].verification_state!=='unverified'||
         verify[0].retention_status!=='active')
        refuse('canonical write not independently re-read; inspect register before retry');
      existing.set(bundle.control_id,evidence.id);
      created++;
    }
    return {
      available:true,recording_kind:'unverified_static_source_metadata_only',
      ticket_id:request.ticket_id,snapshot_id:plan.snapshot_id,
      manifest_digest:plan.manifest_digest,
      processed_from:request.cursor,next_cursor:end,
      total:plan.bundles.length,finished:end===plan.bundles.length,
      created,skipped,remaining:plan.bundles.length-end,
      verification_state:'unverified',evidence_accepted:false,
      decisions_recorded:0,active_tests_executed:0,master_modified:false,
      notice:'Resumable canonical candidate metadata records only. No evidence trust promotion or control verdict.'
    };
  }finally{
    if(locked)await client.query(
      'SELECT pg_advisory_unlock(hashtext($1),hashtext($2))',
      [plan.project_id,plan.snapshot_id+':static-batch']).catch(()=>{});
    client.release();
  }
}
