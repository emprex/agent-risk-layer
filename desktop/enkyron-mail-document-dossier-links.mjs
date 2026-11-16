// ENKYRON M05-B: reviewed dossier links, no duplicated file bytes.
import {randomUUID} from 'node:crypto';

const UUID=/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i;
const CONTROL=/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/;

function workspace(actor){
  if(typeof actor!=='string' ||
     !/^[A-Za-z0-9_.-]{1,80}$/.test(actor))
    throw Error('Invalid local operator');
  return 'local:'+actor;
}

export function validateDossierLink(input){
  if(!input || typeof input!=='object' || Array.isArray(input)
    || !['direction','support'].includes(input.mailbox)
    || !UUID.test(input.message_id||'')
    || !UUID.test(input.attachment_id||'')
    || !['company','ticket'].includes(input.destination_kind)
    || typeof input.destination_id!=='string'
    || !/^[A-Za-z0-9_.:-]{1,128}$/.test(input.destination_id)
    || typeof input.review_note!=='string'
    || CONTROL.test(input.review_note)
    || input.review_note.trim().length<20
    || input.review_note.trim().length>1000
    || input.confirmed!==true)
    throw Error('Exact document, destination and human confirmation required');

  return {...input,review_note:input.review_note.trim()};
}

export async function linkAttachmentToDossier(
  pool,actor,input,{uuid=randomUUID}={}
){
  const key=workspace(actor);
  const req=validateDossierLink(input);
  const db=await pool.connect();

  try{
    await db.query('BEGIN');

    const access=(await db.query(
      "SELECT can_read FROM enkyron_local_mail_access "+
      "WHERE workspace_key=$1 AND mailbox_key=$2 "+
      "AND role='organization_owner_l5'",
      [key,req.mailbox]
    )).rows[0];

    if(access?.can_read!==true)
      throw Error('Mailbox access denied');

    const attachment=(await db.query(
      'SELECT q.original_filename,q.content_sha256,'+
      'q.safety_state,(q.content_bytes IS NOT NULL) AS stored,'+
      't.crm_company_id '+
      'FROM enkyron_mail_attachment_quarantine q '+
      'JOIN enkyron_mail_local_messages m '+
      'ON m.workspace_key=q.workspace_key '+
      'AND m.mailbox_key=q.mailbox_key '+
      'AND m.message_id=q.message_id '+
      'JOIN enkyron_mail_local_threads t '+
      'ON t.workspace_key=m.workspace_key '+
      'AND t.mailbox_key=m.mailbox_key '+
      'AND t.thread_id=m.thread_id '+
      'WHERE q.workspace_key=$1 AND q.mailbox_key=$2 '+
      'AND q.message_id=$3 AND q.attachment_id=$4 '+
      'FOR SHARE OF q',
      [key,req.mailbox,req.message_id,req.attachment_id]
    )).rows[0];

    if(!attachment
      || attachment.safety_state!=='quarantined_unscanned'
      || attachment.stored!==true
      || !/^[a-f0-9]{64}$/.test(attachment.content_sha256||''))
      throw Error('Original attachment must first be stored in quarantine');

    if(req.destination_kind==='company'){
      const company=(await db.query(
        'SELECT id FROM enkyron_crm_companies '+
        'WHERE workspace_key=$1 AND id=$2 FOR SHARE',
        [key,req.destination_id]
      )).rows[0];

      if(!company)throw Error('CRM company unavailable');

      if(attachment.crm_company_id &&
         String(attachment.crm_company_id)!==req.destination_id)
        throw Error('Mail and selected company differ');

    }else{
      const ticket=(await db.query(
        'SELECT id,archived_at FROM arl_workbench_tickets '+
        'WHERE id=$1 FOR SHARE',
        [req.destination_id]
      )).rows[0];

      if(!ticket || ticket.archived_at)
        throw Error('Ticket unavailable or archived');

      if(attachment.crm_company_id){
        const linked=(await db.query(
          'SELECT company_id FROM enkyron_crm_effective_ticket_links '+
          'WHERE workspace_key=$1 AND ticket_id=$2',
          [key,req.destination_id]
        )).rows[0];

        if(!linked ||
           String(linked.company_id)!==String(attachment.crm_company_id))
          throw Error('Mail and ticket belong to different reviewed companies');
      }
    }

    const companyId=req.destination_kind==='company'
      ? req.destination_id:null;
    const ticketId=req.destination_kind==='ticket'
      ? req.destination_id:null;
    const linkId=uuid();

    const inserted=await db.query(
      'INSERT INTO enkyron_mail_document_dossier_links '+
      '(link_id,workspace_key,mailbox_key,message_id,attachment_id,'+
      'company_id,ticket_id,filename_at_review,'+
      'content_sha256_at_review,review_note,linked_by) '+
      'VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) '+
      'ON CONFLICT DO NOTHING RETURNING link_id',
      [linkId,key,req.mailbox,req.message_id,req.attachment_id,
       companyId,ticketId,attachment.original_filename,
       attachment.content_sha256,req.review_note,actor]
    );

    if(inserted.rowCount!==1)
      throw Error('Document already linked to this dossier');

    await db.query('COMMIT');

    return {
      linked:true,
      link_id:linkId,
      destination_kind:req.destination_kind,
      destination_id:req.destination_id,
      safety_state:'quarantined_unscanned',
      note:'Document linked but still unscanned; no file released'
    };

  }catch(error){
    await db.query('ROLLBACK').catch(()=>{});
    throw error;
  }finally{
    db.release();
  }
}


// M05-B2: document references only, never attachment content.
export async function listDossierDocuments(pool, actor, input) {
  const key = workspace(actor);
  const kind = input?.destination_kind;
  const id = input?.destination_id;
  if (!['company','ticket'].includes(kind) ||
      typeof id !== 'string' ||
      !/^[A-Za-z0-9_.:-]{1,128}$/.test(id))
    throw Error('Invalid dossier selection');

  const column = kind === 'company' ? 'company_id' : 'ticket_id';

  try {
    const rows = (await pool.query(
      'SELECT d.link_id,d.mailbox_key,d.message_id,d.attachment_id,'+
      'd.filename_at_review AS filename,'+
      'd.content_sha256_at_review AS sha256,'+
      'd.linked_by,d.linked_at,d.review_note,'+
      'q.declared_size AS size,q.safety_state '+
      'FROM enkyron_mail_document_dossier_links d '+
      'JOIN enkyron_mail_attachment_quarantine q ON '+
      'q.workspace_key=d.workspace_key '+
      'AND q.mailbox_key=d.mailbox_key '+
      'AND q.message_id=d.message_id '+
      'AND q.attachment_id=d.attachment_id '+
      'JOIN enkyron_local_mail_access a ON '+
      'a.workspace_key=d.workspace_key '+
      'AND a.mailbox_key=d.mailbox_key '+
      "AND a.role='organization_owner_l5' AND a.can_read=true "+
      'WHERE d.workspace_key=$1 AND d.'+column+'=$2 '+
      'ORDER BY d.linked_at DESC,d.link_id LIMIT 51',
      [key,id]
    )).rows;
    return {
      available:true,
      destination_kind:kind,
      destination_id:id,
      items:rows.slice(0,50),
      more:rows.length>50
    };
  } catch (error) {
    if (error?.code === '42P01')
      return {available:false,items:[],more:false,
        notice:'Document links require migration 117'};
    throw error;
  }
}

export async function listAttachmentDossierLinks(pool, actor, input) {
  const key = workspace(actor);
  if (!input ||
      !['direction','support'].includes(input.mailbox) ||
      !UUID.test(input.message_id || '') ||
      !UUID.test(input.attachment_id || ''))
    throw Error('Invalid attachment selection');

  try {
    const rows = (await pool.query(
      'SELECT d.link_id,d.company_id,d.ticket_id,'+
      'd.linked_at,d.linked_by,d.review_note '+
      'FROM enkyron_mail_document_dossier_links d '+
      'JOIN enkyron_local_mail_access a ON '+
      'a.workspace_key=d.workspace_key '+
      'AND a.mailbox_key=d.mailbox_key '+
      "AND a.role='organization_owner_l5' AND a.can_read=true "+
      'WHERE d.workspace_key=$1 AND d.mailbox_key=$2 '+
      'AND d.message_id=$3 AND d.attachment_id=$4 '+
      'ORDER BY d.linked_at DESC LIMIT 51',
      [key,input.mailbox,input.message_id,input.attachment_id]
    )).rows;
    return {available:true,items:rows.slice(0,50),
      more:rows.length>50};
  } catch (error) {
    if (error?.code === '42P01')
      return {available:false,items:[],more:false,
        notice:'Document links require migration 117'};
    throw error;
  }
}
