// E02-07A: append-only privacy request intake, not GDPR fulfillment.
import {randomUUID} from 'node:crypto';
import {requireCompanyId} from './enkyron-crm-tickets.mjs';
import {requireContactId} from './enkyron-crm-contact-tickets.mjs';
const TYPES=new Set(['access','rectification','erasure','restriction','objection','portability']);
const CHANNELS=new Set(['email','phone','post','in_person','other']);
function owner(actor){
 if(typeof actor!=='string'||!/^[A-Za-z0-9_.-]{1,80}$/.test(actor))
  throw new Error('CRM invalid local operator');
 return 'local:'+actor;
}
function date(value){
 if(typeof value!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(value))
  throw new Error('CRM invalid request receipt date');
 const d=new Date(value+'T00:00:00.000Z');
 if(!Number.isFinite(d.getTime())||d.toISOString().slice(0,10)!==value)
  throw new Error('CRM invalid request receipt date');
 return value;
}
export function validatePrivacyIntake(input){
 if(!input||typeof input!=='object'||Array.isArray(input))
  throw new Error('CRM invalid privacy intake');
 const keys=new Set(['company_id','contact_id','request_kind','source_channel','received_on','confirmed']);
 if(Object.keys(input).some(key=>!keys.has(key)))
  throw new Error('CRM unsupported privacy intake field');
 if(input.confirmed!==true)throw new Error('CRM human confirmation required');
 if(!TYPES.has(input.request_kind))throw new Error('CRM invalid privacy request type');
 if(!CHANNELS.has(input.source_channel))throw new Error('CRM invalid privacy request channel');
 return {company_id:requireCompanyId(input.company_id),contact_id:requireContactId(input.contact_id),
  request_kind:input.request_kind,source_channel:input.source_channel,
  received_on:date(input.received_on)};
}
export async function listPrivacyRequests(pool,contactId,actor){
 const id=requireContactId(contactId),key=owner(actor);
 try{
  const contact=(await pool.query(
   'SELECT id,company_id FROM enkyron_crm_contacts WHERE workspace_key=$1 AND id=$2',
   [key,id])).rows[0];
  if(!contact)throw new Error('CRM contact not found in local workspace');
  const rows=(await pool.query(
   'SELECT id,request_kind,source_channel,received_on,processing_state,recorded_by,recorded_at '
   +'FROM enkyron_crm_privacy_requests WHERE workspace_key=$1 AND company_id=$2 AND contact_id=$3 '
   +'ORDER BY recorded_at DESC,id DESC LIMIT 51',
   [key,contact.company_id,id])).rows;
  return {available:true,contact,items:rows.slice(0,50),more:rows.length>50,
   notice:'Intake only. Identity, scope, legal basis and response require human review.'};
 }catch(error){
  if(error?.code==='42P01')return {available:false,items:[],
   notice:'CRM privacy request schema 086 is not installed.'};
  throw error;
 }
}
export async function recordPrivacyRequest(pool,input,actor,options={}){
 const request=validatePrivacyIntake(input),key=owner(actor);
 const client=await pool.connect(),uuid=options.uuid??randomUUID;
 try{
  await client.query('BEGIN');
  const contact=(await client.query(
   'SELECT id,company_id FROM enkyron_crm_contacts '
   +'WHERE workspace_key=$1 AND id=$2 FOR KEY SHARE',
   [key,request.contact_id])).rows[0];
  if(!contact)throw new Error('CRM contact not found in local workspace');
  if(contact.company_id!==request.company_id)
   throw new Error('CRM privacy request company mismatch');
  const id=uuid();
  await client.query(
   'INSERT INTO enkyron_crm_privacy_requests '
   +'(id,workspace_key,company_id,contact_id,request_kind,source_channel,received_on,recorded_by) '
   +'VALUES($1,$2,$3,$4,$5,$6,$7,$8)',
   [id,key,request.company_id,request.contact_id,request.request_kind,request.source_channel,
    request.received_on,actor]);
  await client.query('COMMIT');
  return {id,company_id:request.company_id,contact_id:request.contact_id,
   processing_state:'pending_human_review',
   notice:'Intake only. No disclosure, erasure, consent or identity verification.'};
 }catch(error){
  await client.query('ROLLBACK').catch(()=>{});
  throw error;
 }finally{client.release();}
}
