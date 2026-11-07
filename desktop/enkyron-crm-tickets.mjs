// ENKYRON E02: operator-reviewed Client Desk ↔ structured-company associations.
// Ticket rows, their client_name, and legacy sales research remain untouched.
// Local OS user scoping is not authenticated multi-tenant/RBAC authority.
import { randomUUID } from 'node:crypto';
import { boundedSearch, requireTicketId } from './enkyron-contract.mjs';
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

function owner(name){
  if(typeof name!=='string'||!/^[A-Za-z0-9_.-]{1,80}$/.test(name))
    throw new Error('CRM invalid local operator');
  return {actor:name,key:'local:'+name};
}
export function requireCompanyId(id){
  if(typeof id!=='string'||!UUID.test(id))throw new Error('CRM invalid company identifier');
  return id;
}
export function validateTicketLink(input){
  if(!input||typeof input!=='object'||Array.isArray(input))
    throw new Error('CRM invalid ticket association request');
  const company_id=requireCompanyId(input.company_id);
  const ticket_id=requireTicketId(input.ticket_id);
  const source=input.ticket_client_name_at_review;
  if(typeof source!=='string'||!source.trim()||source.length>300
    ||/[\x00-\x1f\x7f]/.test(source))
    throw new Error('CRM invalid reviewed ticket client name');
  const note=input.review_note;
  if(typeof note!=='string'||note.trim().length<20||note.trim().length>1000
    ||/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/.test(note))
    throw new Error('CRM review note must contain 20-1000 characters');
  if(input.reviewed!==true)throw new Error('CRM manual review confirmation required');
  return {company_id,ticket_id,ticket_client_name_at_review:source,
    review_note:note.trim()};
}

export async function listCompanyTickets(pool,companyId,actor){
  const company_id=requireCompanyId(companyId),scope=owner(actor);
  try{
    const company=(await pool.query(
      'SELECT id,name,relationship_state FROM enkyron_crm_companies '
      +'WHERE workspace_key=$1 AND id=$2',
      [scope.key,company_id]
    )).rows[0];
    if(!company)throw new Error('CRM company not found in local workspace');
    const result=await pool.query(
      'SELECT t.id AS ticket_id,t.ticket_number,t.title,t.client_name,t.status,'
      +'t.archived_at,l.review_note,l.linked_by,l.linked_at '
      +'FROM enkyron_crm_ticket_links l JOIN arl_workbench_tickets t ON t.id=l.ticket_id '
      +'WHERE l.workspace_key=$1 AND l.company_id=$2 '
      +'AND NOT EXISTS (SELECT 1 FROM enkyron_crm_ticket_link_revocations r '
      +'WHERE r.workspace_key=l.workspace_key AND r.ticket_id=l.ticket_id) '
      +'ORDER BY l.linked_at DESC,l.id DESC LIMIT 101',
      [scope.key,company_id]
    );
    return {available:true,company,items:result.rows.slice(0,100),more:result.rows.length>100};
  }catch(error){
    if(error?.code==='42P01')return {available:false,items:[],
      notice:'CRM ticket association schema 067 is not installed locally.'};
    throw error;
  }
}

export async function listLinkableTickets(pool,search,actor){
  const q=boundedSearch(search),scope=owner(actor);
  try{
    const result=await pool.query(
      'SELECT t.id AS ticket_id,t.ticket_number,t.title,t.client_name,t.status '
      +'FROM arl_workbench_tickets t '
      +'LEFT JOIN enkyron_crm_ticket_links l '
      +'ON l.ticket_id=t.id AND l.workspace_key=$1 '
      +'WHERE l.ticket_id IS NULL AND t.archived_at IS NULL '
      +"AND ($2='' OR POSITION(lower($2) IN lower(t.ticket_number))>0 "
      +"OR POSITION(lower($2) IN lower(t.title))>0 "
      +"OR POSITION(lower($2) IN lower(t.client_name))>0) "
      +'ORDER BY t.updated_at DESC,t.id LIMIT 101',
      [scope.key,q]
    );
    return {available:true,items:result.rows.slice(0,100),
      more:result.rows.length>100,
      notice:'Only never-linked tickets are listed. Revoked links stay historical and cannot be reassigned in this dialog.'};
  }catch(error){
    if(error?.code==='42P01')return {available:false,items:[],
      notice:'CRM ticket association schema 067 is not installed locally.'};
    throw error;
  }
}

export async function ticketLinkedCompany(pool,ticketId,actor){
  const id=requireTicketId(ticketId),scope=owner(actor);
  try{
    const result=await pool.query(
      'SELECT c.id AS company_id,c.name AS company_name,c.relationship_state,'
      +'l.linked_at,l.linked_by '
      +'FROM enkyron_crm_ticket_links l '
      +'JOIN enkyron_crm_companies c '
      +'ON c.id=l.company_id AND c.workspace_key=l.workspace_key '
      +'WHERE l.workspace_key=$1 AND l.ticket_id=$2 '
      +'AND NOT EXISTS (SELECT 1 FROM enkyron_crm_ticket_link_revocations r '
      +'WHERE r.workspace_key=l.workspace_key AND r.ticket_id=l.ticket_id)',
      [scope.key,id]
    );
    return {available:true,link:result.rows[0]??null};
  }catch(error){
    if(error?.code==='42P01')return {available:false,link:null,
      notice:'CRM ticket association schema 067 is not installed locally.'};
    throw error;
  }
}

export async function linkTicketToCompany(pool,input,actor,options={}){
  const data=validateTicketLink(input),scope=owner(actor),uuid=options.uuid??randomUUID;
  const client=await pool.connect();
  try{
    await client.query('BEGIN');
    const company=(await client.query(
      'SELECT id,name FROM enkyron_crm_companies '
      +'WHERE workspace_key=$1 AND id=$2 FOR KEY SHARE',
      [scope.key,data.company_id]
    )).rows[0];
    if(!company)throw new Error('CRM company not found in local workspace');
    const ticket=(await client.query(
      'SELECT id,client_name,archived_at FROM arl_workbench_tickets '
      +'WHERE id=$1 FOR SHARE',
      [data.ticket_id]
    )).rows[0];
    if(!ticket)throw new Error('CRM ticket not found');
    if(ticket.archived_at)throw new Error('CRM archived ticket cannot be linked');
    if(ticket.client_name!==data.ticket_client_name_at_review)
      throw new Error('CRM ticket client name changed; reopen review');
    const existing=(await client.query(
      'SELECT company_id FROM enkyron_crm_ticket_links '
      +'WHERE workspace_key=$1 AND ticket_id=$2',
      [scope.key,data.ticket_id]
    )).rows[0];
    if(existing)throw new Error('CRM ticket already linked; no silent reassignment');
    const id=uuid();
    await client.query(
      'INSERT INTO enkyron_crm_ticket_links '
      +'(id,workspace_key,company_id,ticket_id,ticket_client_name_at_review,'
      +'review_note,linked_by) VALUES($1,$2,$3,$4,$5,$6,$7)',
      [id,scope.key,data.company_id,data.ticket_id,ticket.client_name,
        data.review_note,scope.actor]
    );
    await client.query(
      'INSERT INTO enkyron_crm_events '
      +'(id,workspace_key,resource_kind,resource_id,event_type,actor_local) '
      +"VALUES($1,$2,'company',$3,'linked',$4)",
      [uuid(),scope.key,data.company_id,scope.actor]
    );
    await client.query('COMMIT');
    return {id,company_id:data.company_id,company_name:company.name,
      ticket_id:data.ticket_id,
      notice:'Ticket associated with company after human review. No ticket fields modified.'};
  }catch(error){
    await client.query('ROLLBACK').catch(()=>{});
    throw error;
  }finally{client.release();}
}
