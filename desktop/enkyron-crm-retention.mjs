// E02-07B: append-only, human-entered retention review log.
// A next review date is NOT a deletion date. A potential hold is NOT a legal hold.
import {randomUUID} from 'node:crypto';
import {requireCompanyId} from './enkyron-crm-tickets.mjs';
import {requireContactId} from './enkyron-crm-contact-tickets.mjs';
const PURPOSES=new Set([
 'prospect_research','service_delivery','support','compliance_records','other']);
const HOLDS=new Set(['not_assessed','potential_hold','none_identified']);
const CONTROL=/[\x00-\x1f\x7f]/;
function owner(actor){
 if(typeof actor!=='string'||!/^[A-Za-z0-9_.-]{1,80}$/.test(actor))
  throw new Error('CRM invalid local operator');
 return 'local:'+actor;
}
function day(value){
 if(typeof value!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(value))
  throw new Error('CRM invalid next review date');
 const d=new Date(value+'T00:00:00.000Z');
 if(!Number.isFinite(d.getTime())||d.toISOString().slice(0,10)!==value)
  throw new Error('CRM invalid next review date');
 return value;
}
export function validateRetentionReview(input){
 if(!input||typeof input!=='object'||Array.isArray(input))
  throw new Error('CRM invalid retention review');
 const keys=new Set([
  'company_id','contact_id','purpose_code','hold_check','next_review_on','review_note','confirmed']);
 if(Object.keys(input).some(key=>!keys.has(key)))
  throw new Error('CRM unsupported retention review field');
 if(input.confirmed!==true)throw new Error('CRM human retention review confirmation required');
 if(!PURPOSES.has(input.purpose_code))throw new Error('CRM invalid retention purpose');
 if(!HOLDS.has(input.hold_check))throw new Error('CRM invalid hold review state');
 if(typeof input.review_note!=='string'||CONTROL.test(input.review_note)||
    input.review_note.trim().length<30||input.review_note.trim().length>500)
  throw new Error('CRM retention review note must contain 30-500 characters');
 return {company_id:requireCompanyId(input.company_id),
  contact_id:requireContactId(input.contact_id),purpose_code:input.purpose_code,
  hold_check:input.hold_check,next_review_on:day(input.next_review_on),
  review_note:input.review_note.trim()};
}
export async function listRetentionReviews(pool,contactId,actor){
 const id=requireContactId(contactId),key=owner(actor);
 try{
  const contact=(await pool.query(
   'SELECT id,company_id FROM enkyron_crm_contacts WHERE workspace_key=$1 AND id=$2',
   [key,id])).rows[0];
  if(!contact)throw new Error('CRM contact not found in local workspace');
  const rows=(await pool.query(
   'SELECT id,purpose_code,hold_check,next_review_on,recorded_by,recorded_at '
   +'FROM enkyron_crm_retention_reviews '
   +'WHERE workspace_key=$1 AND company_id=$2 AND contact_id=$3 '
   +'ORDER BY recorded_at DESC,id DESC LIMIT 51',
   [key,contact.company_id,id])).rows;
  return {available:true,contact,items:rows.slice(0,50),more:rows.length>50,
   notice:'Recorded review only. No retention deadline, lawful basis or hold approval inferred.'};
 }catch(error){
  if(error?.code==='42P01')return {available:false,items:[],
   notice:'CRM retention review migration 087 is not installed locally.'};
  throw error;
 }
}
export async function recordRetentionReview(pool,input,actor,options={}){
 const data=validateRetentionReview(input),key=owner(actor),uuid=options.uuid??randomUUID;
 const client=await pool.connect();
 try{
  await client.query('BEGIN');
  const contact=(await client.query(
   'SELECT id,company_id FROM enkyron_crm_contacts '
   +'WHERE workspace_key=$1 AND id=$2 FOR KEY SHARE',
   [key,data.contact_id])).rows[0];
  if(!contact)throw new Error('CRM contact not found in local workspace');
  if(contact.company_id!==data.company_id)
   throw new Error('CRM retention review company mismatch');
  const id=uuid();
  await client.query(
   'INSERT INTO enkyron_crm_retention_reviews '
   +'(id,workspace_key,company_id,contact_id,purpose_code,hold_check,'
   +'next_review_on,review_note,recorded_by) '
   +'VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)',
   [id,key,data.company_id,data.contact_id,data.purpose_code,data.hold_check,
    data.next_review_on,data.review_note,actor]);
  await client.query('COMMIT');
  return {id,company_id:data.company_id,contact_id:data.contact_id,
   notice:'Recorded review only. No deletion, anonymisation or legal hold performed.'};
 }catch(error){
  await client.query('ROLLBACK').catch(()=>{});
  throw error;
 }finally{client.release();}
}
