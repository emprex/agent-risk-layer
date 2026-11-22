// ENK-06: one reviewed, transactional LOCAL Mail filing operation.
// No provider side-effects, no new CRM/tickets, no attachment release.
// Retrieved attachment bytes must ALREADY be stored in unscanned quarantine.
// Existing individual linking commands remain available for exceptional workflows.
import {randomUUID} from 'node:crypto';

const UUID=/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i;
const SHA=/^[a-f0-9]{64}$/;
const CONTROL=/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/;
const MAILBOXES=new Set(['direction','support']);

function uuid(x,label){
  if(typeof x!=='string'||!UUID.test(x)) throw Error('Invalid '+label);
  return x;
}
function text(x,label,min,max){
  if(typeof x!=='string'||CONTROL.test(x)||x.trim().length<min||x.trim().length>max)
    throw Error('Invalid '+label+' ('+min+'–'+max+' characters)');
  return x.trim();
}
function scope(actor){
  if(typeof actor!=='string'||!/^[A-Za-z0-9_.-]{1,80}$/.test(actor))
    throw Error('Invalid Mail operator');
  return 'local:'+actor;
}
export function validateUnifiedMailFiling(input,{commit=false}={}){
  if(!input||typeof input!=='object'||Array.isArray(input)
    ||!MAILBOXES.has(input.mailbox)) throw Error('Invalid Mail filing request');
  const out={
    mailbox:input.mailbox,
    thread_id:uuid(input.thread_id,'Mail conversation'),
    company_id:uuid(input.company_id,'CRM company'),
    company_name_at_review:text(input.company_name_at_review,'reviewed company name',1,300)
  };
  if(input.ticket!=null){
    const t=input.ticket;
    if(typeof t!=='object'||Array.isArray(t)) throw Error('Invalid ticket selection');
    out.ticket={
      ticket_id:uuid(t.ticket_id,'Client Desk ticket'),
      ticket_number_at_review:text(t.ticket_number_at_review,'reviewed ticket number',3,80),
      client_name_at_review:text(t.client_name_at_review,'reviewed ticket client',1,300)
    };
  }
  if(input.attachment!=null){
    const a=input.attachment;
    if(typeof a!=='object'||Array.isArray(a)) throw Error('Invalid attachment selection');
    const destinations=a.destinations;
    if(!Array.isArray(destinations)||!destinations.length||destinations.length>2
      ||new Set(destinations).size!==destinations.length
      ||destinations.some(d=>d!=='company'&&d!=='ticket')
      ||destinations.includes('ticket')&&!out.ticket)
      throw Error('Invalid attachment destinations');
    out.attachment={
      message_id:uuid(a.message_id,'Mail message'),
      attachment_id:uuid(a.attachment_id,'attachment'),
      content_sha256_at_review:text(a.content_sha256_at_review,'reviewed attachment digest',64,64),
      destinations:[...destinations]
    };
    if(!SHA.test(out.attachment.content_sha256_at_review))
      throw Error('Invalid reviewed attachment digest');
  }
  if(!out.ticket&&!out.attachment)
    throw Error('Select a ticket or an attachment for filing');
  if(commit){
    out.review_note=text(input.review_note,'filing rationale',30,1000);
    if(input.confirmed!==true)throw Error('Explicit human review required');
  }
  return out;
}
async function requireRead(db,key,mailbox){
  const row=(await db.query(
    'SELECT can_read FROM enkyron_local_mail_access WHERE workspace_key=$1 '+
    "AND mailbox_key=$2 AND role='organization_owner_l5'",[key,mailbox]
  )).rows[0];
  if(row?.can_read!==true)throw Error('Mailbox read permission denied');
}
async function inspect(db,key,input,{lock=false}={}){
  await requireRead(db,key,input.mailbox);
  const args=[key,input.mailbox,input.thread_id];
  const thread=(await db.query(
    'SELECT crm_company_id,folder_key,subject FROM enkyron_mail_local_threads '+
    'WHERE workspace_key=$1 AND mailbox_key=$2 AND thread_id=$3'+
    (lock?' FOR UPDATE':''),args
  )).rows[0];
  if(!thread)throw Error('Mail conversation not found');
  if(['spam','trash'].includes(thread.folder_key))
    throw Error('Mail in Spam/Trash cannot be filed');

  const company=(await db.query(
    'SELECT id,name,relationship_state FROM enkyron_crm_companies '+
    'WHERE workspace_key=$1 AND id=$2 FOR KEY SHARE',[key,input.company_id]
  )).rows[0];
  if(!company||company.relationship_state==='inactive')
    throw Error('CRM company unavailable or inactive');
  if(company.name!==input.company_name_at_review)
    throw Error('CRM company changed since review; review again');
  if(thread.crm_company_id!==null &&
     String(thread.crm_company_id)!==String(input.company_id))
    throw Error('Mail conversation already belongs to a different CRM company');

  const result={
    mailbox:input.mailbox,thread_id:input.thread_id,
    subject:thread.subject,company:{id:company.id,name:company.name,
      status:thread.crm_company_id===null?'will_link':'already_linked'},
    ticket:null,attachment:null
  };
  if(input.ticket){
    const t=(await db.query(
      'SELECT id,ticket_number,title,client_name,status,archived_at '+
      'FROM arl_workbench_tickets WHERE id=$1 FOR SHARE',
      [input.ticket.ticket_id]
    )).rows[0];
    if(!t||t.archived_at)throw Error('Ticket unavailable or archived');
    if(t.ticket_number!==input.ticket.ticket_number_at_review ||
       t.client_name!==input.ticket.client_name_at_review)
      throw Error('Ticket changed since review; review again');
    const linked=(await db.query(
      'SELECT company_id FROM enkyron_crm_effective_ticket_links '+
      'WHERE workspace_key=$1 AND ticket_id=$2',
      [key,t.id]
    )).rows[0];
    if(!linked||String(linked.company_id)!==String(company.id))
      throw Error('Ticket and CRM company are not a verified match');
    const old=(await db.query(
      'SELECT ticket_id FROM enkyron_mail_ticket_links '+
      'WHERE workspace_key=$1 AND mailbox_key=$2 AND thread_id=$3 AND ticket_id=$4',
      [...args,t.id]
    )).rows[0];
    result.ticket={id:t.id,number:t.ticket_number,title:t.title,
      client_name:t.client_name,status:old?'already_linked':'will_link'};
  }
  if(input.attachment){
    const a=input.attachment;
    const doc=(await db.query(
      'SELECT q.original_filename,q.content_sha256,q.safety_state,'+
      '(q.content_bytes IS NOT NULL) AS stored '+
      'FROM enkyron_mail_attachment_quarantine q '+
      'JOIN enkyron_mail_local_messages m '+
      'ON m.workspace_key=q.workspace_key AND m.mailbox_key=q.mailbox_key '+
      'AND m.message_id=q.message_id '+
      'WHERE q.workspace_key=$1 AND q.mailbox_key=$2 '+
      'AND q.message_id=$3 AND q.attachment_id=$4 AND m.thread_id=$5 '+
      'FOR SHARE OF q',
      [key,input.mailbox,a.message_id,a.attachment_id,input.thread_id]
    )).rows[0];
    if(!doc)throw Error('Attachment does not belong to the selected conversation');
    if(doc.safety_state!=='quarantined_unscanned'||doc.stored!==true
      ||!SHA.test(doc.content_sha256||''))
      throw Error('Attachment needs explicit retrieval into unscanned quarantine first');
    if(doc.content_sha256!==a.content_sha256_at_review)
      throw Error('Attachment digest changed since review; review again');
    const destinations=[];
    for(const kind of a.destinations){
      const where=kind==='company'?'company_id':'ticket_id';
      const destination_id=kind==='company'?company.id:result.ticket.id;
      const old=(await db.query(
        'SELECT link_id FROM enkyron_mail_document_dossier_links '+
        'WHERE workspace_key=$1 AND mailbox_key=$2 AND message_id=$3 '+
        'AND attachment_id=$4 AND '+where+'=$5',
        [key,input.mailbox,a.message_id,a.attachment_id,destination_id]
      )).rows[0];
      destinations.push({kind,id:destination_id,status:old?'already_linked':'will_link'});
    }
    result.attachment={message_id:a.message_id,attachment_id:a.attachment_id,
      filename:doc.original_filename,sha256:doc.content_sha256,
      safety_state:'quarantined_unscanned',destinations};
  }
  return result;
}
export async function previewUnifiedMailFiling(pool,actor,request){
  const input=validateUnifiedMailFiling(request);
  const key=scope(actor);
  // A preview is a read-only proposal; commit always revalidates from DB.
  return {preview:true,...await inspect(pool,key,input)};
}
export async function commitUnifiedMailFiling(pool,actor,request,{newId=randomUUID}={}){
  const input=validateUnifiedMailFiling(request,{commit:true});
  const key=scope(actor);
  const db=await pool.connect();
  let began=false;
  try{
    await db.query('BEGIN');began=true;
    const plan=await inspect(db,key,input,{lock:true});
    const result={company:plan.company.status,ticket:plan.ticket?.status??'not_requested',
      documents:plan.attachment?.destinations.map(d=>({...d}))??[]};
    if(plan.company.status==='will_link'){
      const updated=await db.query(
        'UPDATE enkyron_mail_local_threads SET crm_company_id=$4 '+
        'WHERE workspace_key=$1 AND mailbox_key=$2 AND thread_id=$3 '+
        'AND crm_company_id IS NULL RETURNING crm_company_id',
        [key,input.mailbox,input.thread_id,input.company_id]
      );
      if(updated.rowCount!==1)throw Error('CRM company link changed during filing');
      result.company='linked';
    }
    if(plan.ticket?.status==='will_link'){
      const t=input.ticket;
      const saved=await db.query(
        'INSERT INTO enkyron_mail_ticket_links '+
        '(workspace_key,mailbox_key,thread_id,ticket_id,ticket_number_at_review,'+
        'client_name_at_review,review_note,linked_by) '+
        'VALUES($1,$2,$3,$4,$5,$6,$7,$8) ON CONFLICT DO NOTHING RETURNING ticket_id',
        [key,input.mailbox,input.thread_id,t.ticket_id,t.ticket_number_at_review,
          t.client_name_at_review,input.review_note,actor]
      );
      if(saved.rowCount!==1)throw Error('Ticket link changed during filing');
      result.ticket='linked';
    }
    if(plan.attachment){
      for(let i=0;i<plan.attachment.destinations.length;i++){
        const destination=plan.attachment.destinations[i];
        if(destination.status==='already_linked')continue;
        const a=input.attachment;
        const saved=await db.query(
          'INSERT INTO enkyron_mail_document_dossier_links '+
          '(link_id,workspace_key,mailbox_key,message_id,attachment_id,'+
          'company_id,ticket_id,filename_at_review,content_sha256_at_review,'+
          'review_note,linked_by) '+
          'VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) '+
          'ON CONFLICT DO NOTHING RETURNING link_id',
          [newId(),key,input.mailbox,a.message_id,a.attachment_id,
            destination.kind==='company'?destination.id:null,
            destination.kind==='ticket'?destination.id:null,
            plan.attachment.filename,plan.attachment.sha256,input.review_note,actor]
        );
        if(saved.rowCount!==1)throw Error('Document link changed during filing');
        result.documents[i].status='linked';
      }
    }
    // Read canonical state before COMMIT, and never report success on partial writes.
    const confirmed=await inspect(db,key,input,{lock:false});
    if(confirmed.company.status!=='already_linked'
      ||(confirmed.ticket&&confirmed.ticket.status!=='already_linked')
      ||confirmed.attachment?.destinations.some(d=>d.status!=='already_linked'))
      throw Error('Filing readback incomplete; transaction rejected');
    await db.query('COMMIT');began=false;
    return {saved:true,mailbox:input.mailbox,thread_id:input.thread_id,
      company_id:input.company_id,ticket_id:input.ticket?.ticket_id??null,
      attachment_id:input.attachment?.attachment_id??null,
      safety_state:input.attachment?'quarantined_unscanned':null,
      provider_unchanged:true,entries:result,
      notice:'Local reviewed associations recorded. No email sent; no attachment released.'};
  }catch(err){
    if(began)await db.query('ROLLBACK').catch(()=>{});
    throw err;
  }finally{db.release();}
}
