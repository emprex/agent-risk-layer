// One read-only deterministic source replay for the 108 canonical controls.
// Projection != evidence verification. Only the already-recorded KB-001 pilot
// has a supported canonical evidence-reference format for digest comparison.
// All other KBs remain prepared for human review; no automated trust promotion.
import {collectTicketStaticCandidates} from './enkyron-control-preparation.mjs';
import {readKb001EvidenceIntegrity} from './enkyron-evidence-integrity.mjs';

const TICKET=/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i;
const CONTROL=/^ARL-KB-(?:00[1-9]|0[1-9]\d|10[0-8])$/;
const DIGEST=/^[a-f0-9]{64}$/;
const SHA=/^[a-f0-9]{40}$/;
function refuse(msg){throw new Error('Batch source replay: '+msg);}

export function shapeBatchSourceReplay({ticketId,preview,master,record=null,duplicate=false}={}) {
  if(!TICKET.test(ticketId||'') || preview?.available!==true ||
     preview.ticket_id!==ticketId || preview.controls_total!==108 ||
     preview.evidence_persisted!==0 || preview.tests_executed!==0 ||
     preview.evidence_accepted!==false ||
     !Array.isArray(preview.criteria) || preview.criteria.length>3000 ||
     !DIGEST.test(preview.collection_sha256||'') ||
     !SHA.test(preview.target_sha||'') ||
     !master?.available || master.integrity!=='verified' ||
     master.snapshot_status!=='current' ||
     preview.project_id!==master.project_id ||
     preview.assessment_id!==master.assessment_id ||
     preview.snapshot_id!==master.snapshot_id ||
     preview.target_sha!==master.target_sha)
    refuse('frozen collection and verified current Master do not match');
  const map=new Map();
  for(let n=1;n<=108;n++){
    const id='ARL-KB-'+String(n).padStart(3,'0');
    map.set(id,{control_id:id,source_requirements:0,
      metadata_projected_unverified:0,incomplete_source_projections:0,
      recorded_source_evidence:'not_inspected',review_required:true});
  }
  const unique=new Set();
  for(const criterion of preview.criteria){
    const control=map.get(criterion?.control_id);
    if(!control || !Number.isSafeInteger(criterion.criterion_number) ||
       criterion.criterion_number<1 || criterion.criterion_number>40 ||
       !DIGEST.test(criterion.projection_sha256||'') ||
       !['static_metadata_projected_unverified','static_metadata_incomplete'].includes(criterion.state))
      refuse('malformed canonical source projection');
    const key=criterion.control_id+':'+criterion.criterion_number;
    if(unique.has(key))refuse('duplicated canonical requirement projection');
    unique.add(key);
    control.source_requirements++;
    if(criterion.state==='static_metadata_projected_unverified')
      control.metadata_projected_unverified++;
    else control.incomplete_source_projections++;
  }
  let status='not_recorded';
  const candidate=preview.kb001_candidate;
  const kb001Projection=preview.criteria.find(c=>
    c.control_id==='ARL-KB-001' && c.criterion_number===1);
  if(duplicate)status='duplicate_record_requires_review';
  else if(record){
    if(!candidate || candidate.control_id!=='ARL-KB-001' ||
       candidate.criterion_number!==1 ||
       candidate.snapshot_id!==preview.snapshot_id ||
       candidate.target_sha!==preview.target_sha ||
       candidate.projection_sha256!==kb001Projection?.projection_sha256 ||
       candidate.collection_sha256!==preview.collection_sha256 ||
       record.control_id!=='ARL-KB-001' ||
       record.snapshot_id!==preview.snapshot_id ||
       record.target_sha!==preview.target_sha ||
       record.record_integrity!=='descriptor_digest_consistent' ||
       record.verification_state!=='unverified')
      refuse('recorded KB-001 provenance is not valid for replay');
    status=record.projection_sha256===candidate.projection_sha256 &&
      record.collection_sha256===preview.collection_sha256
      ? 'recorded_source_fingerprints_reproduced'
      : 'recorded_source_fingerprints_changed';
  }
  map.get('ARL-KB-001').recorded_source_evidence=status;
  const controls=[...map.values()];
  return {
    available:true,schema:'enkyron.batch-source-replay.v1',ticket_id:ticketId,
    project_id:preview.project_id,assessment_id:preview.assessment_id,
    snapshot_id:preview.snapshot_id,target_sha:preview.target_sha,
    controls_total:108,
    controls_with_source_routes:controls.filter(x=>x.source_requirements>0).length,
    source_criteria_total:preview.criteria.length,
    metadata_projected_unverified:controls.reduce((n,x)=>n+x.metadata_projected_unverified,0),
    incomplete_source_projections:controls.reduce((n,x)=>n+x.incomplete_source_projections,0),
    collection_sha256:preview.collection_sha256,
    kb001_evidence_id:record?.evidence_id||null,
    kb001_replay_status:status,
    kb001_recorded_projection_sha256:record?.projection_sha256||null,
    kb001_recorded_collection_sha256:record?.collection_sha256||null,
    per_control:controls,
    recorded_evidence_verified:0,
    applicability_decisions_recorded:0,
    active_tests_executed:0,
    evidence_written:0,master_modified:false,
    source_authenticated:false,approved_purpose_verified:false,
    human_review_required:true,
    notice:'A single 108-control source re-collection. Only the existing KB-001 candidate reference can be compared to a stored canonical record. Other controls are NOT automatically recorded or verified. Reproduced hashes do NOT authenticate source, production environment, approved purpose or permissions.'
  };
}

/**
 * Recollect outside the DB transaction. Then use one repeatable-read,
 * read-only snapshot for verified Master + existing KB-001 evidence digest.
 * Never read source content into the UI or write a new evidence row.
 */
export async function replayTicketSourceEvidence(pool,ticketId,{
  collect=collectTicketStaticCandidates,
  masterReader,
  recordedReader=readKb001EvidenceIntegrity
}={}) {
  if(!TICKET.test(ticketId||''))refuse('exact ticket required');
  if(typeof masterReader!=='function')refuse('verified Master reader required');
  const preview=await collect(pool,ticketId);
  const client=await pool.connect();
  try {
    await client.query('BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY');
    const master=await masterReader(client,ticketId);
    if(!master?.available || master.integrity!=='verified' ||
       master.snapshot_status!=='current' ||
       preview?.project_id!==master.project_id ||
       preview?.assessment_id!==master.assessment_id ||
       preview?.snapshot_id!==master.snapshot_id ||
       preview?.target_sha!==master.target_sha)
      refuse('Master changed after static source replay');
    const ids=(await client.query(
      'SELECT id FROM control_evidence_items '+
      'WHERE project_id=$1 AND system_snapshot_id=$2 AND entry_id=$3 '+
      'AND source_type=$4 AND retention_status=$5 '+
      'ORDER BY created_at DESC,id DESC LIMIT 2',
      [master.project_id,master.snapshot_id,'ARL-KB-001',
       'arl_frozen_source_candidate','active']
    )).rows;
    let record=null;
    if(ids.length===1){
      if(!/^cei_[a-f0-9]{32}$/.test(ids[0]?.id||''))
        refuse('canonical recorded evidence ID malformed');
      record=await recordedReader(client,{
        ticket_id:ticketId,control_id:'ARL-KB-001',evidence_id:ids[0].id
      },async()=>master);
    }
    const result=shapeBatchSourceReplay({
      ticketId,preview,master,record,duplicate:ids.length>1
    });
    await client.query('COMMIT');
    return result;
  } catch(error){
    await client.query('ROLLBACK').catch(()=>{});
    throw error;
  } finally {client.release();}
}
