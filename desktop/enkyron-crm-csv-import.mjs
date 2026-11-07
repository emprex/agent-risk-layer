// E02-08C: only reviewed creation of new CRM company/contacts, atomic and auditable.
// Existing CRM records, marketing consents, and source files are NEVER modified.
import {randomUUID} from 'node:crypto';
import {validateCompany,validateContact} from './enkyron-crm.mjs';
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const SHA=/^[0-9a-f]{64}$/;
const MAX_CONTACTS=500;
function owner(actor){
 if(typeof actor!=='string'||!/^[A-Za-z0-9_.-]{1,80}$/.test(actor))
  throw new Error('CRM invalid local operator');
 return {key:'local:'+actor,actor};
}
function keys(obj,allowed,label){
 if(!obj||typeof obj!=='object'||Array.isArray(obj))
  throw new Error('CRM invalid '+label);
 if(Object.keys(obj).some(k=>!allowed.includes(k)))
  throw new Error('CRM unexpected '+label+' field');
}
function validId(id){
 if(typeof id!=='string'||!UUID.test(id))throw new Error('CRM invalid source record ID');
 return id;
}
function version(v){
 if(!Number.isSafeInteger(v)||v<1||v>2147483647)
  throw new Error('CRM invalid source record version');
 return v;
}
function label(value,allowed,name){
 if(typeof value!=='string'||!allowed.includes(value))
  throw new Error('CRM invalid source '+name);
 return value;
}
export function validateCsvPreview(input){
 keys(input,['format','sha256','company','contact_count','contacts','read_only','warning'],'CSV preview');
 if(input.format!=='ENKYRON_CRM_SELECTED_COMPANY_V1'||input.read_only!==true)
  throw new Error('CRM unapproved CSV preview format');
 if(typeof input.sha256!=='string'||!SHA.test(input.sha256))
  throw new Error('CRM invalid CSV source hash');
 const c=input.company;
 keys(c,['record_id','name','sector','city','country','relationship_state','record_version'],'CSV company');
 const sourceId=validId(c.record_id);
 version(c.record_version);
 label(c.relationship_state,['prospect','client','former_client','inactive'],'company status');
 const company=validateCompany({
  name:c.name,legal_name:'',sector:c.sector,city:c.city,country:c.country,website:''
 });
 if(!Array.isArray(input.contacts)||input.contacts.length>MAX_CONTACTS||
    input.contact_count!==input.contacts.length)
  throw new Error('CRM incomplete or excessive CSV contact snapshot');
 const seen=new Set([sourceId]),names=new Set();
 const contacts=input.contacts.map(x=>{
  keys(x,['record_id','name','role','marketing_permission','record_version'],'CSV contact');
  const originalId=validId(x.record_id);
  if(seen.has(originalId))throw new Error('CRM duplicate CSV source identifier');
  seen.add(originalId);
  version(x.record_version);
  label(x.marketing_permission,['unknown','opt_in','opt_out'],'marketing status');
  const parsed=validateContact({
   company_id:sourceId,full_name:x.name,job_title:x.role,email:'',phone:'',
   marketing_permission:'unknown'
  });
  const folded=parsed.full_name.trim().toLocaleLowerCase('en');
  if(names.has(folded))throw new Error('CRM duplicate contact names in CSV; manual disambiguation required');
  names.add(folded);
  return {source_id:originalId,full_name:parsed.full_name,job_title:parsed.job_title};
 });
 return {sha256:input.sha256,source_company_id:sourceId,company,contacts};
}
export function validateCsvCommit(input){
 keys(input,['preview','review_note','confirmed'],'CSV import approval');
 if(input.confirmed!==true)throw new Error('CRM explicit human import confirmation required');
 if(typeof input.review_note!=='string'||/[\x00-\x1f\x7f]/.test(input.review_note)||
   input.review_note.trim().length<30||input.review_note.trim().length>500)
  throw new Error('CRM import rationale must contain 30–500 characters');
 return {...validateCsvPreview(input.preview),review_note:input.review_note.trim()};
}
async function conflicts(client,request,key){
 const reasons=[];
 const recorded=(await client.query(
  'SELECT EXISTS(SELECT 1 FROM enkyron_crm_csv_import_batches '
  +'WHERE workspace_key=$1 AND (source_sha256=$2 OR source_company_id=$3)) AS yes',
  [key,request.sha256,request.source_company_id])).rows[0];
 if(recorded?.yes)reasons.push('source_already_imported');
 const name=(await client.query(
  'SELECT EXISTS(SELECT 1 FROM enkyron_crm_companies '
  +'WHERE workspace_key=$1 AND lower(btrim(name))=lower(btrim($2))) AS yes',
  [key,request.company.name])).rows[0];
 if(name?.yes)reasons.push('company_name_collision');
 const ids=[request.source_company_id,...request.contacts.map(c=>c.source_id)];
 const existing=(await client.query(
  'SELECT (EXISTS(SELECT 1 FROM enkyron_crm_companies WHERE id=ANY($1::text[])) '
  +'OR EXISTS(SELECT 1 FROM enkyron_crm_contacts WHERE id=ANY($1::text[])) '
  +'OR EXISTS(SELECT 1 FROM enkyron_crm_csv_import_contacts '
  +'WHERE workspace_key=$2 AND source_contact_id=ANY($1::text[]))) AS yes',
  [ids,key])).rows[0];
 if(existing?.yes)reasons.push('source_identity_collision');
 return reasons;
}
export async function inspectCsvImport(pool,input,actor){
 const request=validateCsvPreview(input),scope=owner(actor);
 const client=await pool.connect();let active=false;
 try{
  await client.query('BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY');
  active=true;
  const reasons=await conflicts(client,request,scope.key);
  await client.query('COMMIT');active=false;
  return {available:true,eligible:reasons.length===0,conflicts:reasons,
   source_sha256:request.sha256,company_name:request.company.name,
   contact_count:request.contacts.length,
   notice:'No automatic merge or overwrite. Review is provisional; import rechecks under a transaction. Source status/consent never promoted.'};
 }catch(error){
  if(active)await client.query('ROLLBACK').catch(()=>{});
  if(error?.code==='42P01')return {available:false,eligible:false,
   notice:'CSV import schema 088 is not installed locally.'};
  throw error;
 }finally{client.release();}
}
export async function commitCsvImport(pool,input,actor,options={}){
 const request=validateCsvCommit(input),scope=owner(actor),uuid=options.uuid??randomUUID;
 const client=await pool.connect();
 try{
  await client.query('BEGIN');
  // Serialize CSV imports of the same local workspace; recheck after acquiring lock.
  await client.query('SELECT pg_advisory_xact_lock(hashtext($1))',[scope.key+':enkyron_csv_import']);
  const collision=await conflicts(client,request,scope.key);
  if(collision.length)throw new Error('CRM import refused: '+collision.join(', '));
  const destId=uuid(),batchId=uuid();
  await client.query(
   'INSERT INTO enkyron_crm_companies '
   +'(id,workspace_key,name,legal_name,sector,city,country,website,'
   +'relationship_state,source_type,owner_local) '
   +"VALUES($1,$2,$3,NULL,$4,$5,$6,NULL,'prospect','csv_reviewed_import',$7)",
   [destId,scope.key,request.company.name,request.company.sector||null,
    request.company.city||null,request.company.country||null,scope.actor]);
  await client.query(
   'INSERT INTO enkyron_crm_events '
   +"(id,workspace_key,resource_kind,resource_id,event_type,actor_local) "
   +"VALUES($1,$2,'company',$3,'created',$4)",
   [uuid(),scope.key,destId,scope.actor]);
  await client.query(
   'INSERT INTO enkyron_crm_csv_import_batches '
   +'(id,workspace_key,source_sha256,source_company_id,destination_company_id,'
   +'imported_contact_count,review_note,imported_by) '
   +'VALUES($1,$2,$3,$4,$5,$6,$7,$8)',
   [batchId,scope.key,request.sha256,request.source_company_id,destId,
    request.contacts.length,request.review_note,scope.actor]);
  for(const contact of request.contacts){
   const id=uuid();
   await client.query(
    'INSERT INTO enkyron_crm_contacts '
    +'(id,workspace_key,company_id,full_name,job_title,email,phone,owner_local) '
    +'VALUES($1,$2,$3,$4,$5,NULL,NULL,$6)',
    [id,scope.key,destId,contact.full_name,contact.job_title||null,scope.actor]);
   await client.query(
    'INSERT INTO enkyron_crm_events '
    +"(id,workspace_key,resource_kind,resource_id,event_type,actor_local) "
    +"VALUES($1,$2,'contact',$3,'created',$4)",
    [uuid(),scope.key,id,scope.actor]);
   await client.query(
    'INSERT INTO enkyron_crm_csv_import_contacts '
    +'(id,workspace_key,batch_id,destination_company_id,'
    +'source_contact_id,destination_contact_id) '
    +'VALUES($1,$2,$3,$4,$5,$6)',
    [uuid(),scope.key,batchId,destId,contact.source_id,id]);
  }
  await client.query('COMMIT');
  return {company_id:destId,batch_id:batchId,contact_count:request.contacts.length,
   source_sha256:request.sha256,
   notice:'New CRM records created under human review; all source authority and consent labels downgraded.'};
 }catch(error){
  await client.query('ROLLBACK').catch(()=>{});
  if(error?.code==='23505')throw new Error('CRM CSV provenance or identity conflict; import aborted');
  throw error;
 }finally{client.release();}
}
