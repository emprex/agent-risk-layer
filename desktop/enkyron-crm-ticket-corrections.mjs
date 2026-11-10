// E02-05R: revoking a mistaken company/ticket assertion, NEVER deleting source history.
// A revocation deactivates contact-ticket views too. Reassignment is NOT supported here.
import {randomUUID} from 'node:crypto';
import {requireTicketId} from './enkyron-contract.mjs';
import {requireCompanyId} from './enkyron-crm-tickets.mjs';
const INVALID_CONTROL=/[\x00-\x1f\x7f]/;
function scope(actor){
 if(typeof actor!=='string'||!/^[A-Za-z0-9_.-]{1,80}$/.test(actor))
  throw new Error('CRM invalid local operator');
 return 'local:'+actor;
}
export function validateTicketRevocation(input){
 if(!input||typeof input!=='object'||Array.isArray(input)||
   Object.keys(input).some(k=>!['company_id','ticket_id','expected_client_name','review_note','confirmed'].includes(k)))
  throw new Error('CRM invalid ticket correction request');
 if(input.confirmed!==true)throw new Error('CRM ticket correction requires human confirmation');
 if(typeof input.expected_client_name!=='string'||
    input.expected_client_name.length>300||INVALID_CONTROL.test(input.expected_client_name))
  throw new Error('CRM invalid historical ticket client name');
 if(typeof input.review_note!=='string'||INVALID_CONTROL.test(input.review_note)||
    input.review_note.trim().length<30||input.review_note.trim().length>1000)
  throw new Error('CRM correction requires 30-1000 characters of rationale');
 return {company_id:requireCompanyId(input.company_id),ticket_id:requireTicketId(input.ticket_id),
   expected_client_name:input.expected_client_name,review_note:input.review_note.trim()};
}
export async function revokeTicketAssociation(pool,input,actor,options={}){
 const data=validateTicketRevocation(input),key=scope(actor),uuid=options.uuid??randomUUID;
 const client=await pool.connect();
 try{
  await client.query('BEGIN');
  const link=(await client.query(
   'SELECT l.id,l.company_id,l.ticket_id,t.client_name '
   +'FROM enkyron_crm_ticket_links l '
   +'JOIN arl_workbench_tickets t ON t.id=l.ticket_id '
   +'WHERE l.workspace_key=$1 AND l.company_id=$2 AND l.ticket_id=$3 '
   +'FOR UPDATE OF l',
   [key,data.company_id,data.ticket_id])).rows[0];
  if(!link)throw new Error('CRM reviewed link not found in local workspace');
  if(link.client_name!==data.expected_client_name)
   throw new Error('CRM ticket client name changed; reopen correction review');
  const already=(await client.query(
   'SELECT id FROM enkyron_crm_ticket_link_revocations '
   +'WHERE workspace_key=$1 AND ticket_id=$2',
   [key,data.ticket_id])).rows[0];
  if(already)throw new Error('CRM ticket link already revoked');
  const id=uuid();
  await client.query(
   'INSERT INTO enkyron_crm_ticket_link_revocations '
   +'(id,workspace_key,link_id,company_id,ticket_id,ticket_client_name_at_review,review_note,revoked_by) '
   +'VALUES($1,$2,$3,$4,$5,$6,$7,$8)',
   [id,key,link.id,data.company_id,data.ticket_id,link.client_name,data.review_note,actor]);
  await client.query(
   'INSERT INTO enkyron_crm_events '
   +'(id,workspace_key,resource_kind,resource_id,event_type,actor_local) '
   +"VALUES($1,$2,'company',$3,'corrected',$4)",
   [uuid(),key,data.company_id,actor]);
  await client.query('COMMIT');
  return {revocation_id:id,company_id:data.company_id,ticket_id:data.ticket_id,
   notice:'Original link and source ticket preserved. Association no longer active. Reassignment needs a separate reviewed workflow.'};
 }catch(error){
  await client.query('ROLLBACK').catch(()=>{});
  if(error?.code==='23505')throw new Error('CRM ticket link already revoked');
  throw error;
 }finally{client.release();}
}
export async function listTicketRevocations(pool,companyId,actor){
 const company_id=requireCompanyId(companyId),key=scope(actor);
 const exists=(await pool.query(
  'SELECT id FROM enkyron_crm_companies WHERE workspace_key=$1 AND id=$2',
  [key,company_id])).rows[0];
 if(!exists)throw new Error('CRM company not found in local workspace');
 const rows=(await pool.query(
  'SELECT r.id,r.ticket_id,t.ticket_number,r.revoked_by,r.revoked_at '
  +'FROM enkyron_crm_ticket_link_revocations r '
  +'JOIN arl_workbench_tickets t ON t.id=r.ticket_id '
  +'WHERE r.workspace_key=$1 AND r.company_id=$2 '
  +'ORDER BY r.revoked_at DESC,r.id DESC LIMIT 51',
  [key,company_id])).rows;
 return {available:true,company_id,items:rows.slice(0,50),more:rows.length>50,
  notice:'Read-only correction history; original links, ticket records and rationales remain preserved.'};
}
