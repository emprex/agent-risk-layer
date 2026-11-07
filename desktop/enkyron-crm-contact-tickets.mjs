// E02-05: explicit contact/ticket associations, never inferred from names.
// Requires an independently reviewed company/ticket link, no contact promotion.
import {randomUUID} from 'node:crypto';
import {requireTicketId} from './enkyron-contract.mjs';
import {requireCompanyId} from './enkyron-crm-tickets.mjs';
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const CONTROL=/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/;
function owner(actor){
 if(typeof actor!=='string'||!/^[A-Za-z0-9_.-]{1,80}$/.test(actor))
   throw new Error('CRM invalid local operator');
 return {key:'local:'+actor,actor};
}
export function requireContactId(id){
 if(typeof id!=='string'||!UUID.test(id))throw new Error('CRM invalid contact identifier');
 return id;
}
export function validateContactTicketLink(input){
 if(!input||typeof input!=='object'||Array.isArray(input))
   throw new Error('CRM invalid contact-ticket request');
 if(Object.keys(input).some(k=>!['company_id','contact_id','ticket_id','review_note','confirmed'].includes(k)))
   throw new Error('CRM unsupported contact-ticket request field');
 if(input.confirmed!==true)throw new Error('CRM contact-ticket human confirmation required');
 if(typeof input.review_note!=='string'||CONTROL.test(input.review_note)||
   input.review_note.trim().length<20||input.review_note.trim().length>1000)
   throw new Error('CRM contact-ticket rationale must contain 20-1000 characters');
 return {company_id:requireCompanyId(input.company_id),
   contact_id:requireContactId(input.contact_id),
   ticket_id:requireTicketId(input.ticket_id),review_note:input.review_note.trim()};
}
export async function listContactTickets(pool,contactId,actor){
 const id=requireContactId(contactId),scope=owner(actor);
 try{
   const contact=(await pool.query(
     'SELECT id,company_id,full_name FROM enkyron_crm_contacts WHERE workspace_key=$1 AND id=$2',
     [scope.key,id])).rows[0];
   if(!contact)throw new Error('CRM contact not found in local workspace');
   const rows=(await pool.query(
     'SELECT l.ticket_id,t.ticket_number,t.title,t.status,t.archived_at,'
     +'l.review_note,l.linked_by,l.linked_at FROM enkyron_crm_contact_ticket_links l '
     +'JOIN arl_workbench_tickets t ON t.id=l.ticket_id '
     +'WHERE l.workspace_key=$1 AND l.company_id=$2 AND l.contact_id=$3 '
     +'AND NOT EXISTS (SELECT 1 FROM enkyron_crm_ticket_link_revocations r '
     +'WHERE r.workspace_key=l.workspace_key AND r.ticket_id=l.ticket_id) '
     +'UNION ALL SELECT ra.ticket_id,t.ticket_number,t.title,t.status,t.archived_at,'
     +'ra.review_note,ra.linked_by,ra.linked_at '
     +'FROM enkyron_crm_reassigned_contact_ticket_links ra '
     +'JOIN arl_workbench_tickets t ON t.id=ra.ticket_id '
     +'WHERE ra.workspace_key=$1 AND ra.destination_company_id=$2 AND ra.contact_id=$3 '
     +'ORDER BY linked_at DESC,ticket_id DESC LIMIT 101',
     [scope.key,contact.company_id,id])).rows;
   return {available:true,contact,items:rows.slice(0,100),more:rows.length>100,
     notice:'Manual association only: no verified identity or consent inferred.'};
 }catch(error){
   if(error?.code==='42P01')return {available:false,items:[],
     notice:'CRM contact-ticket schema 085 is not installed.'};
   throw error;
 }
}
export async function linkContactToTicket(pool,input,actor,options={}){
 const req=validateContactTicketLink(input),scope=owner(actor);
 const client=await pool.connect(),newId=options.uuid??randomUUID;
 try{
   await client.query('BEGIN');
   const contact=(await client.query(
     'SELECT id,company_id FROM enkyron_crm_contacts '
     +'WHERE workspace_key=$1 AND id=$2 FOR KEY SHARE',
     [scope.key,req.contact_id])).rows[0];
   if(!contact)throw new Error('CRM contact not found in local workspace');
   if(contact.company_id!==req.company_id)
     throw new Error('CRM contact does not belong to the reviewed company');
   const ticket=(await client.query(
     'SELECT l.ticket_id,t.archived_at FROM enkyron_crm_ticket_links l '
     +'JOIN arl_workbench_tickets t ON t.id=l.ticket_id '
     +'WHERE l.workspace_key=$1 AND l.company_id=$2 AND l.ticket_id=$3 '
     +'AND NOT EXISTS (SELECT 1 FROM enkyron_crm_ticket_link_revocations r '
     +'WHERE r.workspace_key=l.workspace_key AND r.ticket_id=l.ticket_id) '
     +'FOR SHARE OF l,t',
     [scope.key,req.company_id,req.ticket_id])).rows[0];
   if(!ticket)throw new Error('CRM ticket is not reviewed for this company');
   if(ticket.archived_at)throw new Error('CRM archived ticket cannot be linked to a contact');
   if((await client.query(
     'SELECT id FROM enkyron_crm_contact_ticket_links '
     +'WHERE workspace_key=$1 AND contact_id=$2 AND ticket_id=$3',
     [scope.key,req.contact_id,req.ticket_id])).rows.length)
     throw new Error('CRM contact already linked to ticket');
   const id=newId();
   await client.query(
     'INSERT INTO enkyron_crm_contact_ticket_links '
     +'(id,workspace_key,company_id,contact_id,ticket_id,review_note,linked_by) '
     +'VALUES($1,$2,$3,$4,$5,$6,$7)',
     [id,scope.key,req.company_id,req.contact_id,req.ticket_id,req.review_note,scope.actor]);
   await client.query(
     'INSERT INTO enkyron_crm_events '
     +'(id,workspace_key,resource_kind,resource_id,event_type,actor_local) '
     +"VALUES($1,$2,'contact',$3,'linked',$4)",
     [newId(),scope.key,req.contact_id,scope.actor]);
   await client.query('COMMIT');
   return {id,company_id:req.company_id,contact_id:req.contact_id,ticket_id:req.ticket_id,
     notice:'Reviewed link recorded; original ticket and contact unchanged.'};
 }catch(error){
   await client.query('ROLLBACK').catch(()=>{});
   if(error?.code==='23505'&&error?.constraint==='enkyron_crm_contact_ticket_once')
     throw new Error('CRM contact already linked to ticket');
   throw error;
 }finally{client.release();}
}
