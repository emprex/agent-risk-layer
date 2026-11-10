// ENKYRON Mail: single-operator local mail workspace.
// Real rights live in enkyron_local_mail_access; the local OS and PostgreSQL peer
// identify the operator. This is NOT a hardened remote/multi-user auth service.
// No mail is sent unless a saved draft, explicit human confirmation, mailbox
// grant, and private Resend key all pass independently.
import {createHash,randomUUID} from 'node:crypto';
import {loadPrivateResendConfig} from './enkyron-mail-private-config.mjs';
import {createResendInboxReader} from './enkyron-resend-inbox-read.mjs';
import {OWNER_MAILBOXES} from './enkyron-owner-mail-access.mjs';

const UUID=/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i;
const EMAIL=/^[^\s@<>;,]+@[^\s@<>;,]+\.[^\s@<>;,]+$/;
const MAILBOXES=new Map(OWNER_MAILBOXES.map(x=>[x.key,x.address]));
function workspace(operator){
  if(typeof operator!=='string'||!/^[A-Za-z0-9_.-]{1,80}$/.test(operator))
    throw new Error('CRM invalid local operator');
  return 'local:'+operator;
}
function mailboxKey(value){
  if(!MAILBOXES.has(value))throw new Error('CRM unknown mailbox');
  return value;
}
export async function mailAccess(pool,operator){
  const key=workspace(operator);
  let rows;
  try{
    rows=(await pool.query(
      'SELECT mailbox_key,role,can_read,can_send '+
      'FROM enkyron_local_mail_access WHERE workspace_key=$1',
      [key]
    )).rows;
  }catch(e){
    if(e?.code==='42P01')return {schema_ready:false,mailboxes:[]};
    throw e;
  }
  return {
    schema_ready:true,
    mailboxes:rows.filter(row=>row.role==='organization_owner_l5'
      &&MAILBOXES.has(row.mailbox_key)).map(row=>({
      key:row.mailbox_key,address:MAILBOXES.get(row.mailbox_key),
      label:row.mailbox_key==='direction'?'Direction':'Support',
      can_read:row.can_read===true,can_send:row.can_send===true,
    }))
  };
}
async function canAccess(pool,operator,mailbox,action){
  mailboxKey(mailbox);
  const config=await mailAccess(pool,operator);
  const row=config.mailboxes.find(x=>x.key===mailbox);
  if(!row||(action==='read'&&!row.can_read)||(action==='send'&&!row.can_send))
    throw new Error('CRM mailbox permission unavailable');
}
export async function mailStatus(pool,operator){
  const access=await mailAccess(pool,operator);
  let providerConfigured=false;
  try{await loadPrivateResendConfig();providerConfigured=true;}catch{}
  return {
    ...access,provider_configured:providerConfigured,
    notice:!access.schema_ready
      ?'Mail workspace database update needed before saving drafts.'
      :!providerConfigured?'Compose drafts locally; connect Resend to send and receive.'
      :'Resend credential configured; mailbox access is ready for use.',
  };
}
async function readerFor(pool,operator,mailbox){
  await canAccess(pool,operator,mailbox,'read');
  const cfg=await loadPrivateResendConfig();
  return createResendInboxReader({
    organizationId:'local-workspace:'+operator,
    mailboxes:cfg.mailboxes,credentialProvider:cfg.credentialProvider,
    // This explicit LOCAL permission is loaded from PostgreSQL above.
    // Never pass an arbitrary, caller-claimed verified principal.
    authoriseRead:key=>key===mailbox,
  });
}
export async function mailThreads(pool,operator,mailbox){
  const reader=await readerFor(pool,operator,mailbox);
  return reader.listThreads({mailbox,limit:30});
}
export async function mailMessages(pool,operator,mailbox,threadId){
  const reader=await readerFor(pool,operator,mailbox);
  return reader.listThreadEmails({mailbox,threadId,limit:30});
}
export async function mailSent(pool,operator){
  const key=workspace(operator);
  const access=await mailAccess(pool,operator);
  if(!access.schema_ready)return {available:false,items:[]};
  const rows=(await pool.query(
    'SELECT s.id,s.draft_id,s.mailbox_key,s.recipient_email,s.outcome,'+
    's.provider_message_id,s.recorded_at,s.completed_at,d.subject '+
    'FROM enkyron_mail_send_attempts s JOIN enkyron_crm_mail_drafts d '+
    'ON d.workspace_key=s.workspace_key AND d.id=s.draft_id '+
    'WHERE s.workspace_key=$1 ORDER BY s.recorded_at DESC LIMIT 100',
    [key]
  )).rows;
  return {available:true,items:rows};
}
export function validateMailSendRequest(input){
  if(!input||Array.isArray(input)||typeof input!=='object'
      ||typeof input.draft_id!=='string'||!UUID.test(input.draft_id)
      ||!Number.isSafeInteger(input.expected_revision)||input.expected_revision<1
      ||input.recipient_verified!==true||input.confirmed!==true)
    throw new Error('CRM explicit recipient and send confirmation required');
  return {draftId:input.draft_id,revision:input.expected_revision};
}
export async function mailSendDraft(pool,actor,input,{fetchImpl=globalThis.fetch,
  credentialsLoader=loadPrivateResendConfig}={}){
  const {draftId,revision}=validateMailSendRequest(input);
  const scope=workspace(actor),client=await pool.connect();
  let prepared;
  try{
    await client.query('BEGIN');
    const rows=(await client.query(
      'SELECT d.id,d.revision,d.mailbox_key,d.recipient_email,d.subject,d.body_text '+
      'FROM enkyron_crm_mail_drafts d WHERE d.workspace_key=$1 AND d.id=$2 FOR UPDATE',
      [scope,draftId]
    )).rows;
    if(rows.length!==1||rows[0].revision!==revision)
      throw new Error('CRM draft revision changed; reopen it before sending');
    const draft=rows[0];
    mailboxKey(draft.mailbox_key);
    if(typeof draft.recipient_email!=='string'||!EMAIL.test(draft.recipient_email)
        ||typeof draft.subject!=='string'||!draft.subject.trim()
        ||typeof draft.body_text!=='string'||!draft.body_text.trim())
      throw new Error('CRM complete recipient, subject and body before sending');
    const permission=(await client.query(
      'SELECT can_send FROM enkyron_local_mail_access '+
      'WHERE workspace_key=$1 AND mailbox_key=$2 AND role=$3',
      [scope,draft.mailbox_key,'organization_owner_l5']
    )).rows[0];
    if(permission?.can_send!==true)
      throw new Error('CRM mailbox send permission not granted');
    const prior=(await client.query(
      'SELECT id FROM enkyron_mail_send_attempts WHERE workspace_key=$1 AND draft_id=$2',
      [scope,draftId]
    )).rows[0];
    if(prior)throw new Error('CRM this draft was already submitted; review Sent before continuing');
    const reported=(await client.query(
      'SELECT id FROM enkyron_crm_mail_manual_sends '+
      'WHERE workspace_key=$1 AND draft_id=$2',
      [scope,draftId]
    )).rows[0];
    if(reported)throw new Error('CRM draft has an external send record');
    // Ensure the private provider credential exists before reserving the send.
    // No secret is persisted in PostgreSQL or returned to Qt.
    const cfg=await credentialsLoader();
    const apiKey=await cfg.credentialProvider();
    if(!cfg.mailboxes?.[draft.mailbox_key]||!apiKey)
      throw new Error('CRM mail provider not configured');
    const from=MAILBOXES.get(draft.mailbox_key);
    const request={from,to:[draft.recipient_email],subject:draft.subject,text:draft.body_text};
    const attemptId=randomUUID(),idempotency=randomUUID();
    const hash=createHash('sha256').update(JSON.stringify(request)).digest('hex');
    await client.query(
      'INSERT INTO enkyron_mail_send_attempts '+
      '(id,workspace_key,draft_id,draft_revision,mailbox_key,recipient_email,'+
      'payload_sha256,idempotency_key) VALUES($1,$2,$3,$4,$5,$6,$7,$8)',
      [attemptId,scope,draftId,revision,draft.mailbox_key,
        draft.recipient_email,hash,idempotency]
    );
    await client.query('COMMIT');
    prepared={attemptId,idempotency,request,apiKey};
  }catch(error){
    await client.query('ROLLBACK').catch(()=>{});
    throw error;
  }finally{client.release();}

  let providerId=null;
  try{
    const response=await fetchImpl('https://api.resend.com/emails',{
      method:'POST',redirect:'error',signal:AbortSignal.timeout(12000),
      headers:{Authorization:'Bearer '+prepared.apiKey,
        'Content-Type':'application/json','Idempotency-Key':prepared.idempotency},
      body:JSON.stringify(prepared.request),
    });
    if(response?.ok){
      const reply=await response.json();
      if(typeof reply?.id==='string'&&UUID.test(reply.id))
        providerId=reply.id;
    }
  }catch{
    // TIMEOUT and network loss have an uncertain provider outcome.
    // Never auto-retry or silently send another copy.
  }
  const outcome=providerId?'accepted':'uncertain';
  await pool.query(
    'UPDATE enkyron_mail_send_attempts SET outcome=$2,'+
    'provider_message_id=$3,completed_at=NOW() WHERE id=$1',
    [prepared.attemptId,outcome,providerId]
  );
  return {
    outcome,provider_message_id:providerId,
    notice:providerId
      ?'Resend accepted the message. Delivery has not been verified.'
      :'Provider outcome uncertain. Check Resend before trying another email; no automatic retry.',
  };
}
