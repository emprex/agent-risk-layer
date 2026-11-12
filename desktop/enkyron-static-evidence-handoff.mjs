// KB-001 pilot: human-confirmed submission of ONE unverified frozen-Git
// identity candidate through existing authoritative ARL Control Intelligence.
// No second evidence store, automatic verification or applicability change.
import {verifiedMaster} from './enkyron-contract.mjs';
import {readLinkedAssessmentContext} from './enkyron-ticket-assessment.mjs';
import {canonicalControlBinding,readTicketControlDetail} from './enkyron-ticket-controls.mjs';
import {collectTicketStaticCandidates} from './enkyron-control-preparation.mjs';

const UUID=/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i;
const SHA40=/^[0-9a-f]{40}$/;
const SHA256=/^[0-9a-f]{64}$/;
const CONTROL='ARL-KB-001';
const SOURCE_TYPE='arl_frozen_source_candidate';
const refusal=reason=>{throw new Error('Static evidence review: '+reason);};

export function validateKb001EvidenceRecording(input){
  if(!input || typeof input!=='object' || Array.isArray(input) ||
     !UUID.test(input.ticket_id||'') ||
     input.control_id!==CONTROL || input.criterion_number!==1 ||
     typeof input.snapshot_id!=='string' ||
     !/^sys_[A-Za-z0-9_-]{8,100}$/.test(input.snapshot_id) ||
     !SHA40.test(input.target_sha||'') ||
     !SHA256.test(input.collection_sha256||'') ||
     !SHA256.test(input.projection_sha256||'') ||
     input.confirmed!==true ||
     input.acknowledgement!=='I CONFIRM UNVERIFIED SOURCE METADATA ONLY' ||
     typeof input.rationale!=='string' ||
     input.rationale.trim().length<30 || input.rationale.length>600 ||
     /[\u0000-\u001f\u007f]/.test(input.rationale)) {
    refusal('exact KB-001 criterion, snapshot, candidate digests and explicit bounded human rationale required');
  }
  return {ticketId:input.ticket_id,rationale:input.rationale.trim()};
}

export function kb001EvidenceReference(candidate) {
  if(candidate?.control_id!==CONTROL || candidate?.criterion_number!==1 ||
     candidate?.collector!=='target_identity' ||
     candidate?.metadata_only!==true || candidate?.verified!==false ||
     candidate?.criterion_satisfied!==false ||
     !SHA40.test(candidate.target_sha||'') ||
     !SHA256.test(candidate.projection_sha256||'')) {
    refusal('unverified canonical KB-001 candidate required');
  }
  return 'frozen-git:'+candidate.target_sha+':KB001:1:'+candidate.projection_sha256;
}

export function kb001EvidenceLimitations(candidate,rationale) {
  const label=(value,max)=>typeof value==='string' &&
    /^[\w .:-]{1,120}$/.test(value) ? value.slice(0,max) : '(not verified)';
  const result=[
    'UNVERIFIED STATIC METADATA ONLY; not accepted proof.',
    'Collector: target_identity; KB-001 requirement 1.',
    'Frozen Git revision: '+candidate.target_sha,
    'Environment observed: '+label(candidate.observed_environment,80),
    'Source project label: '+label(candidate.observed_project_label,100),
    'Collection SHA256: '+candidate.collection_sha256,
    'Projection SHA256: '+candidate.projection_sha256,
    'Human recording rationale: '+rationale,
    'No verified environment, approved purpose, tools, change approval or control PASS.'
  ].join(' | ');
  if(result.length>2000)refusal('bounded canonical evidence limitations exceeded');
  return result;
}

export async function readKb001VerifiedMaster(pool,scope) {
  const sql='SELECT m.project_id,m.assessment_id,m.system_snapshot_id,m.target_sha, '+
    'm.document_md,m.document_sha256, '+
    's.project_id AS snapshot_project_id,s.status AS snapshot_status, '+
    's.assessment_configuration_json '+
    'FROM assessment_master_dossier_revisions m '+
    'JOIN system_snapshots s ON s.id=m.system_snapshot_id '+
    'WHERE m.project_id=$1 AND m.assessment_id=$2 '+
    'ORDER BY m.revision DESC,m.recorded_at DESC LIMIT 1';
  const rows=(await pool.query(sql,[scope.project_id,scope.assessment_id])).rows;
  if(rows?.length!==1)refusal('a recorded current Master is required');
  const master=rows[0];
  const checked=verifiedMaster(master,scope.project_id,scope.assessment_id);
  if(checked.integrity!=='verified' || master.snapshot_status!=='current' ||
     master.system_snapshot_id!==scope.snapshot_id ||
     master.target_sha!==scope.target_sha) {
    refusal('Master must be integrity-verified and pinned to the current exact snapshot and target');
  }
  return {snapshot_id:scope.snapshot_id,target_sha:scope.target_sha,integrity:'verified'};
}

export async function recordKb001StaticEvidence(pool,input,actor,{
  scopeReader=readLinkedAssessmentContext,
  candidateReader=collectTicketStaticCandidates,
  masterReader=readKb001VerifiedMaster,
  detailReader=readTicketControlDetail,
  bindingReader=canonicalControlBinding,
  evidenceWriter=null
}={}) {
  const {ticketId,rationale}=validateKb001EvidenceRecording(input);
  if(typeof actor!=='string' || !actor)refusal('accountable operator required');
  const owner=(await pool.query(
    'SELECT assigned_to,assessor_name,status,archived_at FROM arl_workbench_tickets WHERE id=$1',
    [ticketId])).rows[0];
  if(!owner || owner.archived_at || owner.status==='closed' ||
     owner.assigned_to!==actor || owner.assessor_name!==actor)
    refusal('active ticket assignment and original accountable operator required');
  const scope=await scopeReader(pool,ticketId);
  if(scope.snapshot_id!==input.snapshot_id || scope.target_sha!==input.target_sha)
    refusal('ticket snapshot changed since human preview');
  await masterReader(pool,scope);
  const detail=await detailReader(pool,{ticket_id:ticketId,control_id:CONTROL});
  if(detail?.snapshot_id!==scope.snapshot_id || detail?.stage!=='applicability' ||
     detail?.applicability_status!=='context_required')
    refusal('pilot KB-001 must retain its existing context-required applicability state');
  const collection=await candidateReader(pool,ticketId);
  const candidate=collection?.kb001_candidate;
  if(collection?.ticket_id!==ticketId ||
     collection?.project_id!==scope.project_id ||
     collection?.assessment_id!==scope.assessment_id ||
     collection?.snapshot_id!==scope.snapshot_id ||
     collection?.target_sha!==scope.target_sha ||
     candidate?.snapshot_id!==scope.snapshot_id ||
     candidate?.target_sha!==scope.target_sha ||
     collection.collection_sha256!==input.collection_sha256 ||
     candidate?.collection_sha256!==input.collection_sha256 ||
     candidate?.projection_sha256!==input.projection_sha256)
    refusal('stale or mismatched source candidate; recollect and review before recording');
  const sourceReference=kb001EvidenceReference(candidate);
  const limitations=kb001EvidenceLimitations(candidate,rationale);
  const binding=await bindingReader(pool,ticketId);
  if(binding.scope?.snapshot_id!==scope.snapshot_id ||
     binding.scope?.target_sha!==scope.target_sha ||
     binding.scope?.project_id!==scope.project_id ||
     binding.binding?.projectId!==scope.project_id ||
     binding.binding?.assessmentId!==scope.assessment_id ||
     !binding.binding?.userId)
    refusal('canonical write identity does not match verified Master and ticket');
  const current=await scopeReader(pool,ticketId);
  if(current.project_id!==scope.project_id ||
     current.assessment_id!==scope.assessment_id ||
     current.snapshot_id!==scope.snapshot_id ||
     current.target_sha!==scope.target_sha ||
     current.target_reference!==scope.target_reference)
    refusal('scope changed after deterministic collection');
  await masterReader(pool,current);
  // Session advisory lock serialises duplicate operator clicks across
  // desktop processes while canonical ARL uses its own database connection.
  const client=await pool.connect();
  let locked=false;
  try {
    await client.query('SELECT pg_advisory_lock(hashtext($1),hashtext($2))',
      [scope.project_id,sourceReference]);
    locked=true;
    const duplicates=(await client.query(
      'SELECT id,verification_state FROM control_evidence_items '+
      'WHERE project_id=$1 AND system_snapshot_id=$2 AND entry_id=$3 '+
      'AND source_type=$4 AND source_reference=$5 '+
      'ORDER BY created_at DESC,id DESC LIMIT 2',
      [scope.project_id,scope.snapshot_id,CONTROL,SOURCE_TYPE,sourceReference])).rows;
    if(duplicates.length>1)refusal('duplicate candidate records already exist; reconciliation required');
    if(duplicates.length===1)
      return {saved:false,already_recorded:true,evidence_id:duplicates[0].id,
        verification_state:duplicates[0].verification_state,
        snapshot_id:scope.snapshot_id,control_id:CONTROL,
        notice:'Existing canonical candidate found; no duplicate created.'};
    const write=evidenceWriter ||
      (await import('../src/control-intelligence.js')).recordControlEvidence;
    const evidence=await write({
      projectId:scope.project_id,userId:binding.binding.userId,controlId:CONTROL,
      input:{systemSnapshotId:scope.snapshot_id,evidenceClass:'observed',
        sourceType:SOURCE_TYPE,sourceReference,limitations}
    });
    if(!evidence?.id || evidence.systemSnapshotId!==scope.snapshot_id ||
       evidence.controlId!==CONTROL || evidence.verificationState!=='unverified' ||
       evidence.sourceType!==SOURCE_TYPE || evidence.sourceReference!==sourceReference)
      refusal('unexpected canonical evidence result; inspect register before retry');
    const written=(await client.query(
      'SELECT id,verification_state,retention_status FROM control_evidence_items '+
      'WHERE id=$1 AND project_id=$2 AND system_snapshot_id=$3 '+
      'AND entry_id=$4 AND source_type=$5 AND source_reference=$6',
      [evidence.id,scope.project_id,scope.snapshot_id,CONTROL,SOURCE_TYPE,sourceReference])).rows;
    if(written.length!==1 || written[0].verification_state!=='unverified' ||
       written[0].retention_status!=='active')
      refusal('canonical evidence write not independently re-read; inspect register before retry');
    return {saved:true,evidence_id:evidence.id,control_id:CONTROL,
      criterion_number:1,snapshot_id:scope.snapshot_id,
      target_sha:scope.target_sha,verification_state:'unverified',
      evidence_accepted:false,tests_executed:0,applicability_unchanged:true,
      notice:'One unverified source metadata candidate recorded in existing ARL evidence register. Human verification remains separate.'};
  } finally {
    if(locked)await client.query(
      'SELECT pg_advisory_unlock(hashtext($1),hashtext($2))',
      [scope.project_id,sourceReference]).catch(()=>{});
    client.release();
  }
}
