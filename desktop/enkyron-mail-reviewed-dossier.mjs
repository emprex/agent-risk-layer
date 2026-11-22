// ENK-06 / #623: atomic, human-reviewed filing of existing Mail references.
// This never downloads attachments, sends mail, creates tickets, or releases files.
// Download to quarantine (when required) happens explicitly BEFORE this transaction.
import {randomUUID} from 'node:crypto';
import {requireCompanyId} from './enkyron-crm-tickets.mjs';
import {requireTicketId} from './enkyron-contract.mjs';

const UUID=/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i;
const CONTROL=/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/;
function scope(actor){
  if(typeof actor!=='string'||!/^[A-Za-z0-9_.-]{1,80}$/.test(actor))
    throw Error('Invalid Mail operator');
  return 'local:'+actor;
}
function text(value,min,max,label){
  if(typeof value!=='string'||CONTROL.test(value)
    ||value.trim().length<min||value.trim().length>max)
    throw Error('Invalid '+label+'; expected '+min+'–'+max+' characters');
  return value.trim();
}
export function validateReviewedMailFiling(input){
  if(!input||typeof input!=='object'||Array.isArray(input)
    ||!['direction','support'].includes(input.mailbox)
    ||!UUID.test(input.thread_id||'')
    ||input.confirmed!==true)
    throw Error('Exact reviewed Mail conversation and human confirmation required');
  const company_id=requireCompanyId(input.company_id);
  const company_name_at_review=text(input.company_name_at_review,1,300,'CRM company name');
  const review_note=text(input.review_note,30,1000,'filing rationale');
  const hasTicket=input.ticket_id!==undefined&&input.ticket_id!==null;
  const hasDocument=input.message_id!==undefined||input.attachment_id!==undefined;
  if(!hasTicket&&!hasDocument)throw Error('Select an existing ticket or one attachment');
  let ticket_id=null,ticket_number_at_review=null,client_name_at_review=null;
  if(hasTicket){
    ticket_id=requireTicketId(input.ticket_id);
    ticket_number_at_review=text(input.ticket_number_at_review,3,80,'ticket number');
    client_name_at_review=text(input.client_name_at_review,1,300,'ticket client');
  }
  let message_id=null,attachment_id=null,filename_at_review=null;
  if(hasDocument){
    if(!UUID.test(input.message_id||'')||!UUID.test(input.attachment_id||''))
      throw Error('Invalid exact attachment identity');
    message_id=input.message_id;
    attachment_id=input.attachment_id;
    filename_at_review=text(input.filename_at_review,1,512,'attachment filename');
  }
  return {mailbox:input.mailbox,thread_id:input.thread_id,company_id,
    company_name_at_review,review_note,ticket_id,ticket_number_at_review,
    client_name_at_review,message_id,attachment_id,filename_at_review};
}

export async function fileReviewedMailDossier(pool,actor,input,{uuid=randomUUID}={}){
  const key=scope(actor),req=validateReviewedMailFiling(input);
  const db=await pool.connect();
  let started=false;
  try{
    await db.query('BEGIN');
    started=true;
    await db.query("SET LOCAL lock_timeout='5000ms'");
    await db.query("SET LOCAL statement_timeout='30000ms'");
    const access=(await db.query(
      'SELECT can_read FROM enkyron_local_mail_access '+
      "WHERE workspace_key=$1 AND mailbox_key=$2 AND role='organization_owner_l5'",
      [key,req.mailbox])).rows[0];
    if(access?.can_read!==true)throw Error('Mail read permission denied');

    // Lock the exact conversation first. This also serializes its other Mail-ticket writes.
    const thread=(await db.query(
      'SELECT crm_company_id,folder_key FROM enkyron_mail_local_threads '+
      'WHERE workspace_key=$1 AND mailbox_key=$2 AND thread_id=$3 FOR UPDATE',
      [key,req.mailbox,req.thread_id])).rows[0];
    if(!thread)throw Error('Saved Mail conversation unavailable');
    if(['spam','trash','sent','drafts'].includes(thread.folder_key))
      throw Error('This Mail folder cannot be filed into business dossiers');
    if(String(thread.crm_company_id)!==req.company_id)
      throw Error('Mail has no matching human-reviewed CRM company');

    const company=(await db.query(
      'SELECT id,name,relationship_state FROM enkyron_crm_companies '+
      'WHERE workspace_key=$1 AND id=$2 FOR SHARE',
      [key,req.company_id])).rows[0];
    if(!company||company.relationship_state==='inactive'
      ||company.name!==req.company_name_at_review)
      throw Error('Reviewed CRM company changed; review again');

    if(req.ticket_id){
      const ticket=(await db.query(
        'SELECT id,ticket_number,client_name,archived_at '+
        'FROM arl_workbench_tickets WHERE id=$1 FOR SHARE',
        [req.ticket_id])).rows[0];
      if(!ticket||ticket.archived_at
        ||ticket.ticket_number!==req.ticket_number_at_review
        ||ticket.client_name!==req.client_name_at_review)
        throw Error('Ticket was archived or its reviewed identity changed');
      const link=(await db.query(
        'SELECT company_id FROM enkyron_crm_effective_ticket_links '+
        'WHERE workspace_key=$1 AND ticket_id=$2',
        [key,req.ticket_id])).rows[0];
      if(String(link?.company_id)!==req.company_id)
        throw Error('Ticket is not associated with the reviewed CRM company');
    }

    let document=null;
    if(req.attachment_id){
      document=(await db.query(
        'SELECT q.original_filename,q.content_sha256,q.safety_state, '+
        '(q.content_bytes IS NOT NULL) AS stored '+
        'FROM enkyron_mail_attachment_quarantine q '+
        'JOIN enkyron_mail_local_messages m ON '+
        'm.workspace_key=q.workspace_key AND m.mailbox_key=q.mailbox_key '+
        'AND m.message_id=q.message_id '+
        'WHERE q.workspace_key=$1 AND q.mailbox_key=$2 '+
        'AND q.message_id=$3 AND q.attachment_id=$4 AND m.thread_id=$5 '+
        'FOR SHARE OF q',
        [key,req.mailbox,req.message_id,req.attachment_id,req.thread_id]
      )).rows[0];
      if(!document||document.safety_state!=='quarantined_unscanned'
        ||document.stored!==true
        ||!/^[0-9a-f]{64}$/.test(document.content_sha256||''))
        throw Error('Attachment must first be securely quarantined without release');
      if(document.original_filename!==req.filename_at_review)
        throw Error('Attachment filename changed; review exact document again');
    }

    const created={company_document:false,ticket_document:false,mail_ticket:false};
    async function addDocument(kind,id){
      const companyId=kind==='company'?id:null;
      const ticketId=kind==='ticket'?id:null;
      const saved=await db.query(
        'INSERT INTO enkyron_mail_document_dossier_links '+
        '(link_id,workspace_key,mailbox_key,message_id,attachment_id,'+
        'company_id,ticket_id,filename_at_review,content_sha256_at_review,'+
        'review_note,linked_by) '+
        'VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) '+
        'ON CONFLICT DO NOTHING RETURNING link_id',
        [uuid(),key,req.mailbox,req.message_id,req.attachment_id,
         companyId,ticketId,document.original_filename,
         document.content_sha256,req.review_note,actor]);
      return saved.rowCount===1;
    }
    if(document){
      created.company_document=await addDocument('company',req.company_id);
      if(req.ticket_id)
        created.ticket_document=await addDocument('ticket',req.ticket_id);
    }
    if(req.ticket_id){
      const saved=await db.query(
        'INSERT INTO enkyron_mail_ticket_links '+
        '(workspace_key,mailbox_key,thread_id,ticket_id,'+
        'ticket_number_at_review,client_name_at_review,review_note,linked_by) '+
        'VALUES($1,$2,$3,$4,$5,$6,$7,$8) '+
        'ON CONFLICT DO NOTHING RETURNING ticket_id',
        [key,req.mailbox,req.thread_id,req.ticket_id,
         req.ticket_number_at_review,req.client_name_at_review,
         req.review_note,actor]);
      created.mail_ticket=saved.rowCount===1;
    }

    // Read back exact canonical references before commit. A conflicting constraint
    // or unexpected response aborts ALL new links in this transaction.
    if(req.ticket_id){
      const read=(await db.query(
        'SELECT ticket_id FROM enkyron_mail_ticket_links '+
        'WHERE workspace_key=$1 AND mailbox_key=$2 AND thread_id=$3 AND ticket_id=$4',
        [key,req.mailbox,req.thread_id,req.ticket_id])).rows;
      if(read.length!==1)throw Error('Mail-ticket exact readback failed');
    }
    if(document){
      const read=(await db.query(
        'SELECT company_id,ticket_id,content_sha256_at_review '+
        'FROM enkyron_mail_document_dossier_links '+
        'WHERE workspace_key=$1 AND mailbox_key=$2 '+
        'AND message_id=$3 AND attachment_id=$4 AND '+
        '(company_id=$5 OR ticket_id=$6)',
        [key,req.mailbox,req.message_id,req.attachment_id,
         req.company_id,req.ticket_id])).rows;
      const companyRows=read.filter(x=>String(x.company_id)===req.company_id);
      const ticketRows=req.ticket_id?
        read.filter(x=>String(x.ticket_id)===req.ticket_id):[];
      if(companyRows.length!==1||(req.ticket_id&&ticketRows.length!==1)
        ||![...companyRows,...ticketRows].every(
          x=>x.content_sha256_at_review===document.content_sha256))
        throw Error('Document exact readback or integrity reference failed');
    }
    await db.query('COMMIT');
    started=false;
    return {available:true,verified:true,mailbox:req.mailbox,
      thread_id:req.thread_id,company_id:req.company_id,
      ticket_id:req.ticket_id,message_id:req.message_id,
      attachment_id:req.attachment_id,
      safety_state:document?'quarantined_unscanned':null,
      created,provider_unchanged:true};
  }catch(error){
    if(started)await db.query('ROLLBACK').catch(()=>{});
    throw error;
  }finally{
    db.release();
  }
}
