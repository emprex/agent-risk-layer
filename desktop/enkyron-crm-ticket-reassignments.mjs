// E02-05S: reviewed ONE-TIME reassignment of a revoked association.
// Original client desk ticket, original company link, revocation, contacts, and events stay immutable.
import {randomUUID} from 'node:crypto';
import {requireTicketId,boundedSearch} from './enkyron-contract.mjs';
import {requireCompanyId} from './enkyron-crm-tickets.mjs';
const CONTROL=/[\x00-\x1f\x7f]/;
function scope(actor){
 if(typeof actor!=='string'||!/^[A-Za-z0-9_.-]{1,80}$/.test(actor))
  throw new Error('CRM invalid local operator');
 return 'local:'+actor;
}
export function validateTicketReassignment(input){
 if(!input||typeof input!=='object'||Array.isArray(input)||
  Object.keys(input).some(k=>![
   'ticket_id','destination_company_id','expected_source_company_id',
   'expected_revocation_id','expected_client_name','destination_record_version',
   'review_note','confirmed'].includes(k)))
  throw new Error('CRM invalid ticket reassignment request');
 if(input.confirmed!==true)throw new Error('CRM human reassignment confirmation required');
 for(const name of ['expected_source_company_id','destination_company_id'])
  requireCompanyId(input[name]);
 if(input.expected_source_company_id===input.destination_company_id)
  throw new Error('CRM reassignment must target a different company');
 if(typeof input.expected_revocation_id!=='string'||
   !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(input.expected_revocation_id))
  throw new Error('CRM invalid revocation lineage');
 if(typeof input.expected_client_name!=='string'||!input.expected_client_name.trim()||
    input.expected_client_name.length>300||CONTROL.test(input.expected_client_name))
  throw new Error('CRM invalid reviewed ticket name');
 if(!Number.isSafeInteger(input.destination_record_version)||
    input.destination_record_version<1)
  throw new Error('CRM invalid target company version');
 if(typeof input.review_note!=='string'||CONTROL.test(input.review_note)||
    input.review_note.trim().length<30||input.review_note.trim().length>1000)
  throw new Error('CRM reassignment rationale must contain 30-1000 characters');
 return {ticket_id:requireTicketId(input.ticket_id),
  destination_company_id:input.destination_company_id,
  expected_source_company_id:input.expected_source_company_id,
  expected_revocation_id:input.expected_revocation_id,
  expected_client_name:input.expected_client_name,
  destination_record_version:input.destination_record_version,
  review_note:input.review_note.trim()};
}
export async function listReassignmentCandidates(pool,companyId,search,actor){
 const destination_company_id=requireCompanyId(companyId),key=scope(actor),q=boundedSearch(search);
 const company=(await pool.query(
  'SELECT id,name,record_version FROM enkyron_crm_companies WHERE workspace_key=$1 AND id=$2',
  [key,destination_company_id])).rows[0];
 if(!company)throw new Error('CRM destination company not found in local workspace');
 const rows=(await pool.query(
  'SELECT rv.ticket_id,rv.id AS revocation_id,rv.company_id AS source_company_id,'
  +'t.ticket_number,t.title,t.client_name,t.status,c.name AS source_company_name '
  +'FROM enkyron_crm_ticket_link_revocations rv '
  +'JOIN arl_workbench_tickets t ON t.id=rv.ticket_id '
  +'JOIN enkyron_crm_companies c ON c.workspace_key=rv.workspace_key AND c.id=rv.company_id '
  +'WHERE rv.workspace_key=$1 AND rv.company_id<>$2 AND t.archived_at IS NULL '
  +'AND NOT EXISTS (SELECT 1 FROM enkyron_crm_ticket_reassignments a '
  +'WHERE a.workspace_key=rv.workspace_key AND a.ticket_id=rv.ticket_id) '
  +"AND ($3='' OR POSITION(lower($3) IN lower(t.ticket_number))>0 "
  +"OR POSITION(lower($3) IN lower(t.title))>0) "
  +'ORDER BY rv.revoked_at DESC,rv.id DESC LIMIT 101',
  [key,destination_company_id,q])).rows;
 return {available:true,company,items:rows.slice(0,100),more:rows.length>100,
  notice:'Revoked tickets only; original company/contact links remain historical. Select an independently verified destination.'};
}
export async function reassignTicket(pool,input,actor,options={}){
 const request=validateTicketReassignment(input),key=scope(actor),uuid=options.uuid??randomUUID;
 const client=await pool.connect();
 try{
  await client.query('BEGIN');
  await client.query('SELECT pg_advisory_xact_lock(hashtext($1))',
   [key+':ticket-reassignment:'+request.ticket_id]);
  const original=(await client.query(
   'SELECT rv.id,rv.company_id,rv.ticket_id,t.client_name,t.archived_at '
   +'FROM enkyron_crm_ticket_link_revocations rv '
   +'JOIN arl_workbench_tickets t ON t.id=rv.ticket_id '
   +'WHERE rv.workspace_key=$1 AND rv.ticket_id=$2 FOR SHARE OF rv,t',
   [key,request.ticket_id])).rows[0];
  if(!original)throw new Error('CRM reviewed revocation is required before reassignment');
  if(original.id!==request.expected_revocation_id||
     original.company_id!==request.expected_source_company_id)
   throw new Error('CRM revocation lineage changed; reopen reviewed reassignment');
  if(original.archived_at)throw new Error('CRM archived ticket cannot be reassigned');
  if(original.client_name!==request.expected_client_name)
   throw new Error('CRM historical ticket name changed; reopen reviewed reassignment');
  if(original.company_id===request.destination_company_id)
   throw new Error('CRM reassignment to original company refused');
  const target=(await client.query(
   'SELECT id,record_version FROM enkyron_crm_companies '
   +'WHERE workspace_key=$1 AND id=$2 FOR KEY SHARE',
   [key,request.destination_company_id])).rows[0];
  if(!target)throw new Error('CRM target company not found in local workspace');
  if(target.record_version!==request.destination_record_version)
   throw new Error('CRM destination company revision changed; reopen reviewed reassignment');
  const existing=(await client.query(
   'SELECT id FROM enkyron_crm_ticket_reassignments '
   +'WHERE workspace_key=$1 AND ticket_id=$2',
   [key,request.ticket_id])).rows[0];
  if(existing)throw new Error('CRM ticket already reassigned; no silent further transfer');
  const id=uuid();
  await client.query(
   'INSERT INTO enkyron_crm_ticket_reassignments '
   +'(id,workspace_key,ticket_id,revocation_id,source_company_id,destination_company_id,'
   +'ticket_client_name_at_review,destination_version_at_review,review_note,assigned_by) '
   +'VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)',
   [id,key,request.ticket_id,original.id,original.company_id,
    request.destination_company_id,original.client_name,
    target.record_version,request.review_note,actor]);
  await client.query(
   'INSERT INTO enkyron_crm_events '
   +'(id,workspace_key,resource_kind,resource_id,event_type,actor_local) '
   +"VALUES($1,$2,'company',$3,'corrected',$4)",
   [uuid(),key,request.destination_company_id,actor]);
  await client.query('COMMIT');
  return {reassignment_id:id,ticket_id:request.ticket_id,
   source_company_id:original.company_id,company_id:request.destination_company_id,
   notice:'Reviewed reassignment recorded. No ticket fields or historical contact assertions were changed.'};
 }catch(error){
  await client.query('ROLLBACK').catch(()=>{});
  if(error?.code==='23505')throw new Error('CRM ticket reassignment already recorded');
  throw error;
 }finally{client.release();}
}
