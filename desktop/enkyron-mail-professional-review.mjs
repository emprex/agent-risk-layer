// M03-I: exact, read-only professional send review, local operator only.
// No provider request or send attempt is made by this module.
import {prepareProfessionalMailPayload,professionalPayloadFingerprint}
  from './enkyron-mail-professional-payload.mjs';
import {OWNER_MAILBOXES} from './enkyron-owner-mail-access.mjs';

const UUID=/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i;
const MAILBOXES=new Map(OWNER_MAILBOXES.map(x=>[x.key,x.address]));

export function validateProfessionalReviewRequest(input){
  if(!input||typeof input!=='object'||Array.isArray(input)||
      typeof input.draft_id!=='string'||!UUID.test(input.draft_id)||
      !Number.isSafeInteger(input.expected_revision)||input.expected_revision<1)
    throw new Error('CRM exact professional draft and revision required');
  return {draftId:input.draft_id,revision:input.expected_revision};
}

export async function reviewProfessionalSendDraft(pool,actor,input){
  const {draftId,revision}=validateProfessionalReviewRequest(input);
  if(typeof actor!=='string'||!/^[A-Za-z0-9_.-]{1,80}$/.test(actor))
    throw new Error('CRM invalid local operator');
  const scope='local:'+actor;
  const client=await pool.connect();
  try{
    await client.query('BEGIN READ ONLY');
    const row=(await client.query(
      'SELECT id,revision,mailbox_key,recipient_email,subject,body_text,'+
      'to_recipients,cc_recipients,bcc_recipients '+
      'FROM enkyron_crm_mail_drafts WHERE workspace_key=$1 AND id=$2',
      [scope,draftId]
    )).rows[0];
    if(!row||row.revision!==revision)
      throw new Error('CRM draft changed; reopen it before review');
    const grant=(await client.query(
      'SELECT can_send FROM enkyron_local_mail_access '+
      'WHERE workspace_key=$1 AND mailbox_key=$2 AND role=$3',
      [scope,row.mailbox_key,'organization_owner_l5']
    )).rows[0];
    if(grant?.can_send!==true)
      throw new Error('CRM mailbox send permission not granted');
    const prior=(await client.query(
      'SELECT id FROM enkyron_mail_send_attempts WHERE workspace_key=$1 AND draft_id=$2',
      [scope,draftId]
    )).rows[0];
    if(prior)throw new Error('CRM draft already submitted; check Sent');
    const reported=(await client.query(
      'SELECT id FROM enkyron_crm_mail_manual_sends '+
      'WHERE workspace_key=$1 AND draft_id=$2',
      [scope,draftId]
    )).rows[0];
    if(reported)throw new Error('CRM draft has an external send record');
    const payload=prepareProfessionalMailPayload(row);
    if(payload.from!==MAILBOXES.get(row.mailbox_key))
      throw new Error('CRM sender identity mismatch');
    const confirmation_sha256=professionalPayloadFingerprint(payload);
    await client.query('COMMIT');
    return {draft_id:draftId,revision,payload,confirmation_sha256,
      notice:'Read-only review. Nothing sent. Delivery remains unverified after acceptance.'};
  }catch(e){
    await client.query('ROLLBACK').catch(()=>{});
    throw e;
  }finally{client.release();}
}
