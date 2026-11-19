// ENKYRON T05: scope-bound, append-only human qualification of EXISTING static
// evidence candidates. No re-collection, applicability write, test or trust promotion.
import crypto from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {readLinkedAssessmentContext} from './enkyron-ticket-assessment.mjs';

const TICKET=/^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/i;
const KB=/^ARL-KB-(?:00[1-9]|0[1-9][0-9]|10[0-8])$/;
const ID=/^cei_[a-f0-9]{32}$/;
const HEX=/^[a-f0-9]{64}$/;
const SHA=/^[a-f0-9]{40}$/;
const PATH=/^[a-zA-Z0-9_./-]{1,220}$/;
const DISPOSITIONS=new Set(['static_observation','evidence_gap','authorised_test_required']);
const refuse=message=>{throw new Error('T05 source qualification: '+message);};
const digest=value=>crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');
const clean=(v,min,max,label)=>{
  if(typeof v!=='string'||v.trim().length<min||v.length>max||
     /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(v))
    refuse(label+' length or characters invalid');
  return v.trim();
};

export function validateT05Identity(value) {
  if(!value || typeof value!=='object'||Array.isArray(value)||
     !TICKET.test(value.ticket_id||'')||
     !KB.test(value.control_id||'')||
     !ID.test(value.evidence_id||''))
    refuse('exact existing ticket, control and candidate evidence ID required');
  return {ticket_id:value.ticket_id,control_id:value.control_id,
    evidence_id:value.evidence_id};
}

export function validateT05Review(value,{commit=false}={}) {
  const id=validateT05Identity(value);
  if(!Number.isSafeInteger(value.criterion_number)||
     value.criterion_number<1||value.criterion_number>40||
     !DISPOSITIONS.has(value.disposition))refuse('criterion and disposition required');
  const rationale=clean(value.rationale,40,2000,'Rationale');
  const limitations=clean(value.limitations,20,1600,'Limitations');
  let source_path=null,source_start_line=null,source_end_line=null;
  if(value.disposition==='static_observation'){
    source_path=clean(value.source_path,1,220,'Source path');
    if(!PATH.test(source_path)||source_path.startsWith('/')||
       source_path.split('/').some(p=>p==='..'||p==='.'||p==='')||
       !Number.isSafeInteger(value.source_start_line)||
       !Number.isSafeInteger(value.source_end_line)||
       value.source_start_line<1||value.source_end_line<value.source_start_line||
       value.source_end_line-value.source_start_line>79||
       value.source_end_line>200000)
      refuse('a bounded relative frozen-source line range is required');
    source_start_line=value.source_start_line;
    source_end_line=value.source_end_line;
  } else if (value.source_path||value.source_start_line||value.source_end_line) {
    refuse('gap/test-required dispositions cannot claim source proof');
  }
  if(commit&&(value.confirmed!==true||
      !HEX.test(value.preview_digest||'')||
      !(value.expected_previous_id===null||
        /^[a-f0-9-]{36}$/i.test(value.expected_previous_id||''))))
    refuse('confirmed exact preview digest and prior review ID required');
  return {...id,criterion_number:value.criterion_number,
    disposition:value.disposition,rationale,limitations,
    source_path,source_start_line,source_end_line};
}

// The T04 bundle records a projection fingerprint per machine-readable criterion,
// not proof. Parse only those already-saved identifiers, never recollect 851 files.
export function existingCriteria(row){
  if(!row || row.verification_state!=='unverified' ||
     row.retention_status!=='active')refuse('candidate is no longer active/unverified');
  const text=String(row.limitations||'');
  const map=new Map();
  if(row.source_type==='arl_static_projection_bundle'){
    const part=/Criterion projections:\s*([^|]+)/.exec(text)?.[1];
    if(!part)refuse('bundle has no recorded criterion fingerprints');
    for(const m of part.matchAll(/(?:^|[, ]+)(\d{1,2}):([a-f0-9]{64})(?=,|\s|$)/g)){
      const n=Number(m[1]);if(n<1||n>40||map.has(n))refuse('invalid projection index');
      map.set(n,m[2]);
    }
  } else if(row.source_type==='arl_frozen_source_candidate' &&
            row.entry_id==='ARL-KB-001'){
    const m=/Projection SHA256:\s*([a-f0-9]{64})/.exec(text);
    if(m)map.set(1,m[1]);
  } else refuse('not an existing T04 source-metadata candidate');
  if(!map.size)refuse('no criterion in saved candidate');
  return [...map].sort((a,b)=>a[0]-b[0])
    .map(([criterion_number,projection_sha256])=>({criterion_number,projection_sha256}));
}

function verifyScope(master,scope,id) {
  if(!master?.available||master.integrity!=='verified'||
     master.snapshot_status!=='current'||
     master.project_id!==scope.project_id||
     master.assessment_id!==scope.assessment_id||
     master.snapshot_id!==scope.snapshot_id||
     master.target_sha!==scope.target_sha||!SHA.test(scope.target_sha||''))
    refuse('latest Master and existing frozen assessment binding must agree');
  if(master.ticket_id&&master.ticket_id!==id.ticket_id)
    refuse('master ticket identity mismatch');
}

function verifyCandidate(row,master,id){
  if(!row || row.id!==id.evidence_id||row.entry_id!==id.control_id||
     row.project_id!==master.project_id||
     row.system_snapshot_id!==master.snapshot_id||
     row.verification_state!=='unverified' ||row.retention_status!=='active' ||
     !HEX.test(row.integrity_digest||'')||
     !String(row.source_reference||'').includes(master.target_sha))
    refuse('candidate is absent, stale, or outside frozen scope');
  return existingCriteria(row);
}

async function current(pool,id,masterReader,scopeReader) {
  const scope=await scopeReader(pool,id.ticket_id);
  const master=await masterReader(pool,id.ticket_id);
  verifyScope(master,scope,id);
  const rows=(await pool.query(
    'SELECT id,project_id,system_snapshot_id,entry_id,source_type,'+
    'source_reference,limitations,integrity_digest,verification_state,retention_status '+
    'FROM control_evidence_items WHERE id=$1 AND project_id=$2 AND '+
    'system_snapshot_id=$3 AND entry_id=$4',
    [id.evidence_id,master.project_id,master.snapshot_id,id.control_id])).rows;
  if(rows.length!==1)refuse('exact candidate not found');
  const criteria=verifyCandidate(rows[0],master,id);
  const reviews=(await pool.query(
    'SELECT id,criterion_number,disposition,source_path,source_start_line,'+
    'source_end_line,source_excerpt_sha256,rationale,limitations,review_digest,'+
    'recorded_by,recorded_at FROM enkyron_t05_source_qualifications '+
    'WHERE ticket_id=$1 AND candidate_id=$2 AND control_id=$3 '+
    'ORDER BY recorded_at DESC,id DESC LIMIT 100',
    [id.ticket_id,id.evidence_id,id.control_id])).rows;
  const latest=new Map();
  for(const row of reviews)if(!latest.has(row.criterion_number))
    latest.set(row.criterion_number,row);
  return {scope,master,criteria,latest,reviews};
}

export async function readT05Qualification(pool,input,masterReader,
  scopeReader=readLinkedAssessmentContext){
  const id=validateT05Identity(input);
  const data=await current(pool,id,masterReader,scopeReader);
  return {available:true,...id,
    project_id:data.master.project_id,
    assessment_id:data.master.assessment_id,
    snapshot_id:data.master.snapshot_id,target_sha:data.master.target_sha,
    criteria:data.criteria,
    latest_reviews:[...data.latest.values()].map(r=>({
      id:r.id,criterion_number:r.criterion_number,disposition:r.disposition,
      rationale:r.rationale,limitations:r.limitations,review_digest:r.review_digest,
      recorded_by:r.recorded_by,recorded_at:r.recorded_at
    })),
    candidate_verification_state:'unverified',
    evidence_accepted:false,active_tests_executed:0,
    notice:'T05 is a separate human source-qualification ledger. Existing source metadata remains UNVERIFIED; no control PASS/FAIL.'};
}

export function frozenSourceExcerpt(repo,sha,sourcePath,first,last){
  if(!SHA.test(sha||'')||!PATH.test(sourcePath||'')||
     sourcePath.startsWith('/')||
     sourcePath.split('/').some(x=>!x||x==='..'||x==='.')||
     !Number.isSafeInteger(first)||!Number.isSafeInteger(last)||
     first<1||last<first||last-first>79)refuse('invalid frozen source anchor');
  // Git is called with argument arrays, not through a shell. This reads one
  // blob from the pinned commit; no checkout, execution, scan or target write.
  let text;
  try {
    const head=execFileSync('git',['-C',repo,'rev-parse','HEAD'],
      {encoding:'utf8',timeout:5000,maxBuffer:10000}).trim();
    if(head!==sha)refuse('local target HEAD differs from frozen revision');
    text=execFileSync('git',['-C',repo,'show',sha+':'+sourcePath],
      {encoding:'utf8',timeout:5000,maxBuffer:2*1024*1024});
  }catch(e){
    if(String(e?.message||'').startsWith('T05 source qualification:'))throw e;
    refuse('exact frozen Git source unavailable; no qualification');
  }
  const lines=text.split(/\r?\n/);
  if(last>lines.length)refuse('source line range exceeds frozen file');
  const excerpt=lines.slice(first-1,last).join('\n');
  if(excerpt.length<1||excerpt.length>12000)
    refuse('source excerpt must be bounded and non-empty');
  return {source_excerpt_sha256:crypto.createHash('sha256')
      .update(excerpt,'utf8').digest('hex'),
    source_reference:'frozen-git:'+sha+':'+sourcePath+'#L'+first+'-L'+last,
    preview_excerpt:excerpt.slice(0,4000)};
}

async function prepare(pool,request,masterReader,scopeReader){
  const input=validateT05Review(request);
  const data=await current(pool,input,masterReader,scopeReader);
  const criterion=data.criteria.find(c=>c.criterion_number===input.criterion_number);
  if(!criterion)refuse('criterion not present in the original T04 candidate');
  const previous=data.latest.get(input.criterion_number)||null;
  const source=input.disposition==='static_observation'?
    frozenSourceExcerpt(data.scope.target_reference,data.scope.target_sha,
      input.source_path,input.source_start_line,input.source_end_line):null;
  const payload={
    schema:'enkyron.t05.source-qualification.v1',
    ticket_id:input.ticket_id,project_id:data.master.project_id,
    assessment_id:data.master.assessment_id,
    snapshot_id:data.master.snapshot_id,target_sha:data.master.target_sha,
    control_id:input.control_id,evidence_id:input.evidence_id,
    criterion_number:input.criterion_number,
    projection_sha256:criterion.projection_sha256,
    disposition:input.disposition,
    source_path:input.source_path,
    source_start_line:input.source_start_line,
    source_end_line:input.source_end_line,
    source_excerpt_sha256:source?.source_excerpt_sha256||null,
    rationale:input.rationale,limitations:input.limitations
  };
  return {...payload,preview_digest:digest(payload),
    expected_previous_id:previous?.id||null,preview_excerpt:source?.preview_excerpt||null,
    source_reference:source?.source_reference||null,
    previous_disposition:previous?.disposition||null};
}

export async function previewT05Qualification(pool,input,masterReader,
  scopeReader=readLinkedAssessmentContext){
  const record=await prepare(pool,input,masterReader,scopeReader);
  return {available:true,...record,needs_confirmation:true,
    evidence_accepted:false,candidate_verification_state:'unverified',
    active_tests_executed:0,
    notice:'Verify the selected criterion, actual code anchor and limitations. This records human review, NOT evidence trust promotion.'};
}

export async function recordT05Qualification(pool,request,actor,masterReader,
  scopeReader=readLinkedAssessmentContext){
  const input=validateT05Review(request,{commit:true});
  if(typeof actor!=='string'||!actor)refuse('authenticated OS operator required');
  const client=await pool.connect();
  try{
    await client.query('BEGIN');
    const ticket=(await client.query(
      'SELECT id,assigned_to,assessor_name,status,archived_at '+
      'FROM arl_workbench_tickets WHERE id=$1 FOR UPDATE',
      [input.ticket_id])).rows[0];
    if(!ticket||ticket.status==='closed'||ticket.archived_at||
       ticket.assigned_to!==actor||ticket.assessor_name!==actor)
      refuse('original assigned accountable operator required');
    const verified=await prepare(client,request,masterReader,scopeReader);
    if(verified.preview_digest!==request.preview_digest||
       verified.expected_previous_id!==request.expected_previous_id)
      refuse('preview or prior decision changed; reopen T05 preview');
    if(verified.expected_previous_id){
      const previous=(await client.query(
        'SELECT review_digest FROM enkyron_t05_source_qualifications WHERE id=$1',
        [verified.expected_previous_id])).rows[0];
      if(previous?.review_digest===verified.preview_digest){
        await client.query('COMMIT');
        return {saved:false,already_recorded:true,review_id:verified.expected_previous_id,
          control_id:input.control_id,criterion_number:input.criterion_number,
          candidate_verification_state:'unverified',evidence_accepted:false};
      }
    }
    const reviewId=crypto.randomUUID();
    await client.query(
      'INSERT INTO enkyron_t05_source_qualifications ('+
      'id,ticket_id,project_id,assessment_id,snapshot_id,target_sha,'+
      'control_id,candidate_id,criterion_number,projection_sha256,disposition,'+
      'source_path,source_start_line,source_end_line,source_excerpt_sha256,'+
      'rationale,limitations,review_digest,supersedes_id,recorded_by) '+
      'VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20)',
      [reviewId,verified.ticket_id,verified.project_id,verified.assessment_id,
       verified.snapshot_id,verified.target_sha,verified.control_id,
       verified.evidence_id,verified.criterion_number,verified.projection_sha256,
       verified.disposition,verified.source_path,verified.source_start_line,
       verified.source_end_line,verified.source_excerpt_sha256,
       verified.rationale,verified.limitations,verified.preview_digest,
       verified.expected_previous_id,actor]);
    await client.query('COMMIT');
    return {saved:true,already_recorded:false,review_id:reviewId,
      review_digest:verified.preview_digest,control_id:input.control_id,
      criterion_number:input.criterion_number,
      snapshot_id:verified.snapshot_id,
      candidate_verification_state:'unverified',evidence_accepted:false,
      active_tests_executed:0,
      notice:'Append-only T05 human qualification recorded. Candidate trust unchanged. No tests or verdict.'};
  }catch(e){await client.query('ROLLBACK').catch(()=>{});throw e;}
  finally{client.release();}
}
