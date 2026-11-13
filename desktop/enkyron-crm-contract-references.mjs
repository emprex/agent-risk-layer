// E07-05B: log UNVERIFIED documentary references, never approval/signatures/test authority.
import {createHash,randomUUID} from 'node:crypto';
const UUID=/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
const KIND=new Set(['nda','engagement_agreement','dpa','test_permission']);
const CTRL=/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/;
function bounded(v,name,min,max){
 if(typeof v!=='string'||v.length>max||CTRL.test(v))
  throw new Error('CRM invalid contractual reference '+name);
 const s=v.trim();
 if(s.length<min||s.length>max)throw new Error('CRM contractual reference '+name+' length');
 return s;
}
function owner(actor){
 if(typeof actor!=='string'||!/^[A-Za-z0-9_.-]{1,80}$/.test(actor))
  throw new Error('CRM invalid local operator');
 return {key:'local:'+actor,name:actor};
}
export function validateContractReference(input){
 if(!input||typeof input!=='object'||Array.isArray(input))
  throw new Error('CRM invalid contractual reference');
 const allowed=new Set(['proposal_id','expected_revision','expected_sow_revision',
  'document_kind','source_reference','review_note','confirmed']);
 if(Object.keys(input).some(k=>!allowed.has(k)))
  throw new Error('CRM unsupported contractual reference property');
 if(input.confirmed!==true)
  throw new Error('CRM explicit confirmation of UNVERIFIED reference required');
 if(typeof input.proposal_id!=='string'||!UUID.test(input.proposal_id))
  throw new Error('CRM invalid proposal identifier');
 if(!Number.isSafeInteger(input.expected_revision)||input.expected_revision<1||
    !Number.isSafeInteger(input.expected_sow_revision)||input.expected_sow_revision<1)
  throw new Error('CRM invalid SOW source revision');
 if(!KIND.has(input.document_kind))
  throw new Error('CRM invalid document kind');
 return {proposal_id:input.proposal_id,
   expected_revision:input.expected_revision,
   expected_sow_revision:input.expected_sow_revision,
   document_kind:input.document_kind,
   source_reference:bounded(input.source_reference,'source',5,300),
   review_note:bounded(input.review_note,'note',20,500)};
}
const PROPOSAL='SELECT id,revision FROM enkyron_crm_proposal_drafts '
  +'WHERE workspace_key=$1 AND id=$2';
const SOW='SELECT sow_revision,status FROM enkyron_crm_sow_draft_versions '
  +'WHERE workspace_key=$1 AND proposal_id=$2 AND proposal_revision=$3 '
  +'ORDER BY sow_revision DESC LIMIT 1';
export async function recordContractReference(pool,input,actor,options={}){
 const data=validateContractReference(input),scope=owner(actor),client=await pool.connect();
 try{
  await client.query('BEGIN');
  const p=(await client.query(PROPOSAL+' FOR UPDATE',
   [scope.key,data.proposal_id])).rows[0];
  if(!p)throw new Error('CRM proposal not found in local workspace');
  if(p.revision!==data.expected_revision)
   throw new Error('CRM proposal revision changed; refresh the source review');
  const sow=(await client.query(SOW,
   [scope.key,data.proposal_id,data.expected_revision])).rows[0];
  if(!sow||sow.sow_revision!==data.expected_sow_revision||
     sow.status!=='operator_draft_unapproved')
   throw new Error('CRM SOW version changed; refresh the source review');
  const hash=createHash('sha256').update(data.source_reference,'utf8').digest('hex');
  const id=(options.uuid??randomUUID)();
  await client.query(
   'INSERT INTO enkyron_crm_contract_references '
   +'(id,workspace_key,proposal_id,proposal_revision,sow_revision,'
   +'document_kind,source_reference,source_sha256,review_note,recorded_by) '
   +'VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)',
   [id,scope.key,data.proposal_id,data.expected_revision,
    data.expected_sow_revision,data.document_kind,data.source_reference,
    hash,data.review_note,scope.name]
  );
  await client.query('COMMIT');
  return {id,proposal_id:data.proposal_id,proposal_revision:data.expected_revision,
   sow_revision:data.expected_sow_revision,evidence_status:'operator_reference_unverified',
   can_approve_sow:false,can_sign:false,can_accept_engagement:false,
   testing_authorised:false,
   notice:'Only an unverified reference was logged; no contract or test permission exists from this action.'};
 }catch(e){
  await client.query('ROLLBACK').catch(()=>{});
  if(e?.code==='23505')throw new Error('CRM contract reference already logged for this exact SOW version');
  if(e?.code==='42P01')throw new Error('CRM contractual reference schema 101 is not installed');
  throw e;
 }finally{client.release();}
}
