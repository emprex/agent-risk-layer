// E07-04B1: operator-authored, immutable SOW planning drafts only.
import {createHash,randomUUID} from 'node:crypto';
const UUID=/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
const CONTROL=/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/;
const FIELDS=['in_scope','out_of_scope','deliverables','acceptance_criteria','target_inventory','dependencies'];
function owner(actor){
 if(typeof actor!=='string'||!/^[A-Za-z0-9_.-]{1,80}$/.test(actor))
  throw new Error('CRM invalid local operator');
 return {key:'local:'+actor,name:actor};
}
function proposalId(id){
 if(typeof id!=='string'||!UUID.test(id))throw new Error('CRM invalid SOW proposal ID');
 return id;
}
function bounded(value,key,min,max){
 if(typeof value!=='string'||value.length>max||CONTROL.test(value))
  throw new Error('CRM invalid SOW '+key);
 const v=value.trim();
 if(v.length<min||v.length>max)throw new Error('CRM SOW '+key+' requires '+min+'-'+max+' characters');
 return v;
}
export function validateSowDraft(input){
 if(!input||typeof input!=='object'||Array.isArray(input))
  throw new Error('CRM invalid SOW draft');
 const allowed=new Set(['proposal_id','expected_revision','expected_sow_revision','confirmed','review_note',...FIELDS]);
 if(Object.keys(input).some(k=>!allowed.has(k)))
  throw new Error('CRM unsupported SOW draft property');
 if(input.confirmed!==true)throw new Error('CRM explicit human draft confirmation required');
 if(!Number.isSafeInteger(input.expected_revision)||input.expected_revision<1)
  throw new Error('CRM invalid proposal revision');
 if(!Number.isSafeInteger(input.expected_sow_revision)||input.expected_sow_revision<0)
  throw new Error('CRM invalid SOW revision');
 const v={proposal_id:proposalId(input.proposal_id),expected_revision:input.expected_revision,
  expected_sow_revision:input.expected_sow_revision};
 for(const k of FIELDS)v[k]=bounded(input[k],k,20,3000);
 v.review_note=bounded(input.review_note,'review_note',30,1000);
 return v;
}
const PROPOSAL='SELECT id,title,revision FROM enkyron_crm_proposal_drafts '
 +'WHERE workspace_key=$1 AND id=$2';
const HISTORY='SELECT id,proposal_revision,sow_revision,'
 +FIELDS.join(',')+',review_note,status,content_sha256,recorded_by,recorded_at '
 +'FROM enkyron_crm_sow_draft_versions WHERE workspace_key=$1 AND proposal_id=$2 '
 +'ORDER BY proposal_revision DESC,sow_revision DESC LIMIT 21';
const LATEST='SELECT sow_revision,content_sha256 FROM enkyron_crm_sow_draft_versions '
 +'WHERE workspace_key=$1 AND proposal_id=$2 AND proposal_revision=$3 '
 +'ORDER BY sow_revision DESC LIMIT 1';
function contentHash(d){
 return createHash('sha256').update(JSON.stringify([
  d.proposal_id,d.expected_revision,...FIELDS.map(k=>d[k])
 ])).digest('hex');
}
export async function readSowDraft(pool,id,actor){
 const pid=proposalId(id),scope=owner(actor),client=await pool.connect();
 try{
  await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
  const proposal=(await client.query(PROPOSAL,[scope.key,pid])).rows[0];
  if(!proposal)throw new Error('CRM proposal not found in local workspace');
  const rows=(await client.query(HISTORY,[scope.key,pid])).rows;
  const current=rows.find(x=>x.proposal_revision===proposal.revision)??null;
  await client.query('COMMIT');
  return {available:true,proposal_id:pid,proposal_revision:proposal.revision,
   proposal_title:proposal.title,current,
   history:rows.slice(0,20).map(({id,proposal_revision,sow_revision,status,
     content_sha256,recorded_by,recorded_at})=>({
     id,proposal_revision,sow_revision,status,content_sha256,recorded_by,recorded_at
   })),more:rows.length>20,can_approve_sow:false,
   can_sign:false,testing_authorised:false,
   notice:'Manual working SOW: no approved scope, contract, signature or permission to test.'};
 }catch(e){
  await client.query('ROLLBACK').catch(()=>{});
  if(e?.code==='42P01')return {available:false,
   notice:'SOW draft migration 099 not installed; no data changed.'};
  throw e;
 }finally{client.release();}
}
export async function recordSowDraft(pool,input,actor,options={}){
 const data=validateSowDraft(input),scope=owner(actor),client=await pool.connect();
 try{
  await client.query('BEGIN');
  // The proposal row serialises competing SOW writes AND proposed fee edits.
  const proposal=(await client.query(PROPOSAL+' FOR UPDATE',[scope.key,data.proposal_id])).rows[0];
  if(!proposal)throw new Error('CRM proposal not found in local workspace');
  if(proposal.revision!==data.expected_revision)
   throw new Error('CRM proposal revision changed; reopen the SOW draft');
  const last=(await client.query(LATEST,[scope.key,data.proposal_id,data.expected_revision])).rows[0]??null;
  const lastVersion=last?.sow_revision??0;
  if(lastVersion!==data.expected_sow_revision)
   throw new Error('CRM SOW draft changed concurrently; reload latest version');
  const content_sha256=contentHash(data);
  if(last?.content_sha256===content_sha256)
   throw new Error('CRM SOW draft content unchanged; no duplicate revision');
  const id=(options.uuid??randomUUID)(),sow_revision=lastVersion+1;
  await client.query(
   'INSERT INTO enkyron_crm_sow_draft_versions '
   +'(id,workspace_key,proposal_id,proposal_revision,sow_revision,'
   +FIELDS.join(',')+',review_note,content_sha256,recorded_by) '
   +'VALUES('+Array.from({length:5+FIELDS.length+3},(_,i)=>'$'+(i+1)).join(',')+')',
   [id,scope.key,data.proposal_id,data.expected_revision,sow_revision,
    ...FIELDS.map(k=>data[k]),data.review_note,content_sha256,scope.name]
  );
  await client.query('COMMIT');
  return {id,proposal_id:data.proposal_id,proposal_revision:data.expected_revision,
   sow_revision,status:'operator_draft_unapproved',
   can_approve_sow:false,can_sign:false,testing_authorised:false,
   notice:'SOW planning draft version saved. Not a contract, approved scope or testing authority.'};
 }catch(e){
  await client.query('ROLLBACK').catch(()=>{});
  if(e?.code==='23505')throw new Error('CRM SOW draft changed concurrently; reload');
  if(e?.code==='42P01')throw new Error('CRM SOW migration 099 missing; no write performed');
  throw e;
 }finally{client.release();}
}
