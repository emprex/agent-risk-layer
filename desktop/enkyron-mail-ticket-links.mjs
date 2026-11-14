// E04-04B: manually reviewed, immutable Mail <-> Client Desk ticket links.
// Local-only operator scope. Not a substitute for authenticated multi-user RBAC.
// No provider mutations, no ticket creation, no automatic identity inference.
import {requireTicketId} from './enkyron-contract.mjs';
const UUID=/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/;
const MAILBOXES=new Set(['direction','support']);
const CONTROL=/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/;
function owner(actor){
  if(typeof actor!=='string'||!/^[A-Za-z0-9_.-]{1,80}$/.test(actor))
    throw Error('Invalid Mail operator');
  return 'local:'+actor;
}
function target(input){
  if(!input||typeof input!=='object'||Array.isArray(input)
    ||!MAILBOXES.has(input.mailbox)
    ||typeof input.thread_id!=='string'||!UUID.test(input.thread_id))
    throw Error('Invalid Mail ticket selection');
  return {mailbox:input.mailbox,thread_id:input.thread_id};
}
function reviewText(value,name,min,max){
  if(typeof value!=='string'||CONTROL.test(value)
    ||value.trim().length<min||value.trim().length>max)
    throw Error('Invalid Mail '+name+'; required '+min+'–'+max+' characters');
  return value.trim();
}
export function validateMailTicketLink(input){
  const selected=target(input);
  const ticket_id=requireTicketId(input.ticket_id);
  if(input.confirmed!==true)throw Error('Explicit Mail ticket review required');
  const ticket_number_at_review=reviewText(input.ticket_number_at_review,'ticket number',3,80);
  const client_name_at_review=reviewText(input.client_name_at_review,'reviewed client name',1,300);
  const review_note=reviewText(input.review_note,'ticket link rationale',30,1000);
  return {...selected,ticket_id,ticket_number_at_review,client_name_at_review,review_note};
}
async function permission(db,key,mailbox){
  const a=(await db.query(
    "SELECT can_read FROM enkyron_local_mail_access WHERE workspace_key=$1 "+
    "AND mailbox_key=$2 AND role='organization_owner_l5'",
    [key,mailbox])).rows[0];
  if(a?.can_read!==true)throw Error('Mail read permission not granted');
}
function unavailable(e){
  if(e?.code==='42P01')return {available:false,items:[],
    notice:'Mail ticket links are not installed; schema 116 requires explicit approval.'};
  throw e;
}
export async function listMailTicketLinks(pool,actor,input){
  const key=owner(actor),{mailbox,thread_id}=target(input);
  try{
    await permission(pool,key,mailbox);
    const rows=(await pool.query(
      'SELECT l.ticket_id,t.ticket_number,t.title,t.client_name,t.status,'+
      't.archived_at,l.linked_by,l.linked_at,l.review_note '+
      'FROM enkyron_mail_ticket_links l JOIN arl_workbench_tickets t ON t.id=l.ticket_id '+
      'WHERE l.workspace_key=$1 AND l.mailbox_key=$2 AND l.thread_id=$3 '+
      'ORDER BY l.linked_at DESC,l.ticket_id LIMIT 51',
      [key,mailbox,thread_id])).rows;
    return {available:true,mailbox,thread_id,items:rows.slice(0,50),more:rows.length>50};
  }catch(e){return unavailable(e);}
}
export async function listTicketMailLinks(pool,actor,input){
  const key=owner(actor);
  const ticket_id=requireTicketId(input?.ticket_id);
  try{
    const rows=(await pool.query(
      'SELECT l.mailbox_key,l.thread_id,t.subject,t.last_message_at,'+
      'l.linked_by,l.linked_at,l.review_note '+
      'FROM enkyron_mail_ticket_links l JOIN enkyron_mail_local_threads t '+
      'ON t.workspace_key=l.workspace_key AND t.mailbox_key=l.mailbox_key '+
      'AND t.thread_id=l.thread_id JOIN enkyron_local_mail_access a '+
      'ON a.workspace_key=l.workspace_key AND a.mailbox_key=l.mailbox_key '+
      "AND a.role='organization_owner_l5' AND a.can_read=true "+
      'WHERE l.workspace_key=$1 AND l.ticket_id=$2 '+
      'ORDER BY l.linked_at DESC,l.thread_id LIMIT 51',
      [key,ticket_id])).rows;
    return {available:true,ticket_id,items:rows.slice(0,50),more:rows.length>50};
  }catch(e){return unavailable(e);}
}
export async function linkMailTicket(pool,actor,input){
  const key=owner(actor),data=validateMailTicketLink(input);
  const client=await pool.connect();
  try{
    await client.query('BEGIN');
    await permission(client,key,data.mailbox);
    const thread=(await client.query(
      'SELECT crm_company_id,folder_key FROM enkyron_mail_local_threads '+
      'WHERE workspace_key=$1 AND mailbox_key=$2 AND thread_id=$3 FOR UPDATE',
      [key,data.mailbox,data.thread_id])).rows[0];
    if(!thread)throw Error('Saved Mail conversation not found');
    if(['spam','trash'].includes(thread.folder_key))
      throw Error('Mail in Spam/Trash cannot be linked to a ticket');
    const ticket=(await client.query(
      'SELECT id,ticket_number,title,client_name,archived_at '+
      'FROM arl_workbench_tickets WHERE id=$1 FOR SHARE',
      [data.ticket_id])).rows[0];
    if(!ticket||ticket.archived_at)throw Error('Ticket unavailable or archived');
    if(ticket.ticket_number!==data.ticket_number_at_review
      ||ticket.client_name!==data.client_name_at_review)
      throw Error('Ticket identity changed; review again');
    // Never link a mail thread to a ticket assigned to a DIFFERENT reviewed company.
    if(thread.crm_company_id){
      const company=(await client.query(
        'SELECT company_id FROM enkyron_crm_effective_ticket_links '+
        'WHERE workspace_key=$1 AND ticket_id=$2',
        [key,data.ticket_id])).rows[0];
      if(!company)
        throw Error('Mail has a reviewed CRM company but ticket has no reviewed ticket company');
      if(String(company.company_id)!==String(thread.crm_company_id))
        throw Error('Mail and ticket belong to different reviewed CRM companies');
    }
    const result=await client.query(
      'INSERT INTO enkyron_mail_ticket_links '+
      '(workspace_key,mailbox_key,thread_id,ticket_id,ticket_number_at_review,'+
      'client_name_at_review,review_note,linked_by) '+
      'VALUES($1,$2,$3,$4,$5,$6,$7,$8) ON CONFLICT DO NOTHING '+
      'RETURNING ticket_id',
      [key,data.mailbox,data.thread_id,data.ticket_id,data.ticket_number_at_review,
       data.client_name_at_review,data.review_note,actor]);
    if(result.rowCount!==1)throw Error('Mail ticket link already exists; review existing association');
    await client.query('COMMIT');
    return {linked:true,mailbox:data.mailbox,thread_id:data.thread_id,
      ticket_id:data.ticket_id,ticket_number:ticket.ticket_number,
      provider_unchanged:true,ticket_unchanged:true};
  }catch(e){await client.query('ROLLBACK').catch(()=>{});throw e;}
  finally{client.release();}
}
