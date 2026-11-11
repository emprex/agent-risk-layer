// ENKYRON Mail: single-operator local mail workspace.
// Real rights live in enkyron_local_mail_access; the local OS and PostgreSQL peer
// identify the operator. This is NOT a hardened remote/multi-user auth service.
// No mail is sent unless a saved draft, explicit human confirmation, mailbox
// grant, and private Resend key all pass independently.
import {createHash,randomUUID} from 'node:crypto';
import {loadPrivateResendConfig} from './enkyron-mail-private-config.mjs';
import {createResendInboxReader} from './enkyron-resend-inbox-read.mjs';
import {OWNER_MAILBOXES} from './enkyron-owner-mail-access.mjs';
import {uniqueCompanyForRecipient,verifiedContactForCompany} from './enkyron-crm-mail-recipients.mjs';

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
  let filing=[];
  try{
    filing=(await pool.query(
      'SELECT mailbox_key,can_manage FROM enkyron_local_mail_access '+
      'WHERE workspace_key=$1',[workspace(operator)]
    )).rows;
  }catch(e){if(e?.code!=='42703'&&e?.code!=='42P01')throw e;}
  return {
    ...access,
    mailboxes:access.mailboxes.map(row=>({...row,
      can_manage:filing.some(x=>x.mailbox_key===row.key&&x.can_manage===true)
    })),
    provider_configured:providerConfigured,
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
// A broken support inbox must not hide healthy direction mail (or vice versa).
// However, an entirely failed lookup is NEVER reported as an empty folder.
export function combineMailboxPages(folder,settled){
  const names=['direction','support'];
  if(!['inbox','archive','spam','trash'].includes(folder)
    ||!Array.isArray(settled)||settled.length!==names.length)
    throw new Error('Invalid mailbox page combination');
  const usable=settled.filter(x=>x.status==='fulfilled').map(x=>x.value);
  const unavailable=names.filter((name,i)=>settled[i].status!=='fulfilled');
  if(usable.length===0)
    throw new Error('Both mail accounts are unavailable. Check provider access.');
  const combined=usable.flatMap(p=>p.items)
    .sort((a,b)=>String(b.last_message_at||'')
      .localeCompare(String(a.last_message_at||'')));
  return {
    mailbox:'all',folder,items:combined.slice(0,50),
    has_more:usable.some(p=>p.has_more)||combined.length>50,
    unavailable_mailboxes:unavailable,
    partial:unavailable.length!==0,
  };
}
export async function mailThreads(pool,operator,mailbox,folder='inbox',after=null){
  if(!['inbox','archive','spam','trash'].includes(folder))
    throw new Error('Invalid mailbox folder');
  if(after!==null&&!UUID.test(after))throw new Error('Invalid mail pagination cursor');
  // The two mail accounts are read independently and failures are explicit.
  if(mailbox==='all'){
    const pages=await Promise.allSettled(
      ['direction','support'].map(name=>mailThreads(pool,operator,name,folder))
    );
    return combineMailboxPages(folder,pages);
  }
  const reader=await readerFor(pool,operator,mailbox);
  const page=await reader.listThreads({mailbox,folder,limit:30,after});
  const items=page.items.map(item=>({...item,mailbox}));
  // Best-effort local index: never misrepresent a failed cache write as an
  // unavailable provider inbox. Full email bodies are not silently stored.
  try{
    const scope=workspace(operator);
    for(const item of items){
      if(!UUID.test(item.id))continue;
      await pool.query(
        'INSERT INTO enkyron_mail_thread_index '
        +'(workspace_key,mailbox_key,thread_id,folder,subject,last_message_at) '
        +'VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT '
        +'(workspace_key,mailbox_key,thread_id) DO UPDATE SET '
        +'folder=EXCLUDED.folder,subject=EXCLUDED.subject,'
        +'last_message_at=EXCLUDED.last_message_at,indexed_at=NOW()',
        [scope,mailbox,item.id,folder,item.subject||'',item.last_message_at||'']
      );
    }
  }catch(error){if(error?.code!=='42P01')throw error;}
  return {...page,folder,items};
}
export async function mailMessages(pool,operator,mailbox,threadId,after=null){
  if(after!==null&&!UUID.test(after))throw new Error('Invalid mail pagination cursor');
  const reader=await readerFor(pool,operator,mailbox);
  return reader.listThreadEmails({mailbox,threadId,limit:30,after});
}
export async function mailSent(pool,operator){
  const key=workspace(operator);
  const access=await mailAccess(pool,operator);
  if(!access.schema_ready)return {available:false,items:[]};
  const rows=(await pool.query(
    'SELECT s.id,s.draft_id,s.mailbox_key,s.recipient_email,s.outcome,'+
    's.provider_message_id,s.recorded_at,s.completed_at,d.subject,'+
    'd.company_id,co.name AS company_name '+
    'FROM enkyron_mail_send_attempts s JOIN enkyron_crm_mail_drafts d '+
    'ON d.workspace_key=s.workspace_key AND d.id=s.draft_id '+
    'LEFT JOIN enkyron_crm_companies co '+
    'ON co.workspace_key=d.workspace_key AND co.id=d.company_id '+
    'WHERE s.workspace_key=$1 ORDER BY s.recorded_at DESC LIMIT 100',
    [key]
  )).rows;
  return {available:true,items:rows};
}
// Link metadata for an existing submitted email. This NEVER calls Resend,
// changes the recipient, or pretends a provider acceptance is delivery.
export function validateMailLinkRequest(input){
  if(!input||Array.isArray(input)||typeof input!=='object'
      ||!UUID.test(input.draft_id||'')
      ||!UUID.test(input.company_id||'')
      ||!UUID.test(input.contact_id||'')
      ||input.confirmed!==true)
    throw new Error('CRM explicit sent-mail link confirmation required');
  return {draftId:input.draft_id,companyId:input.company_id,
    contactId:input.contact_id};
}
export async function mailLinkSent(pool,actor,input,{uuid=randomUUID}={}){
  const data=validateMailLinkRequest(input),scope=workspace(actor);
  const client=await pool.connect();
  try{
    await client.query('BEGIN');
    const draft=(await client.query(
      'SELECT d.id,d.company_id,d.opportunity_id,d.recipient_email,d.subject,'+
      'd.body_text,d.mailbox_key,d.revision FROM enkyron_crm_mail_drafts d '+
      'JOIN enkyron_mail_send_attempts s ON s.workspace_key=d.workspace_key '+
      'AND s.draft_id=d.id WHERE d.workspace_key=$1 AND d.id=$2 FOR UPDATE OF d',
      [scope,data.draftId]
    )).rows[0];
    if(!draft)throw new Error('CRM submitted message not found');
    if(draft.company_id||draft.opportunity_id)
      throw new Error('CRM submitted message is already linked');
    const unique=await uniqueCompanyForRecipient(client,draft.recipient_email,actor);
    if(!unique||unique!==data.companyId)
      throw new Error('CRM recipient has no unique active contact-company match');
    await verifiedContactForCompany(client,data.contactId,data.companyId,
      draft.recipient_email,actor);
    const version=draft.revision+1;
    await client.query(
      'UPDATE enkyron_crm_mail_drafts SET company_id=$3,revision=$4,'+
      'updated_by=$5,updated_at=NOW() WHERE workspace_key=$1 AND id=$2',
      [scope,data.draftId,data.companyId,version,actor]
    );
    const digest=createHash('sha256').update(JSON.stringify([
      draft.mailbox_key,draft.recipient_email,draft.subject,draft.body_text,
      'crm_link',data.companyId,data.contactId
    ])).digest('hex');
    await client.query(
      'INSERT INTO enkyron_crm_mail_draft_events '+
      '(id,workspace_key,draft_id,revision,event_type,content_sha256,actor_local) '+
      "VALUES($1,$2,$3,$4,'edited',$5,$6)",
      [uuid(),scope,data.draftId,version,digest,actor]
    );
    await client.query('COMMIT');
    return {linked:true,company_id:data.companyId,revision:version,
      notice:'CRM association recorded. The email was not sent again.'};
  }catch(e){
    await client.query('ROLLBACK').catch(()=>{});
    throw e;
  }finally{client.release();}
}
// Read-only delivery/status check for a locally recorded provider message.
// Uses only the stored Resend ID; never accepts arbitrary URLs or sends mail.
// Does not persist a verdict or transform provider acceptance into delivery.
export async function mailCheckProviderStatus(pool,actor,draftId,{
  fetchImpl=globalThis.fetch,credentialsLoader=loadPrivateResendConfig
}={}){
  if(typeof draftId!=='string'||!UUID.test(draftId))
    throw new Error('CRM invalid submitted draft identifier');
  const key=workspace(actor);
  const row=(await pool.query(
    'SELECT s.provider_message_id,s.outcome,s.mailbox_key,s.recipient_email,'
    +'d.subject FROM enkyron_mail_send_attempts s '
    +'JOIN enkyron_crm_mail_drafts d ON d.workspace_key=s.workspace_key '
    +'AND d.id=s.draft_id WHERE s.workspace_key=$1 AND s.draft_id=$2',
    [key,draftId]
  )).rows[0];
  if(!row)throw new Error('CRM no Resend submission for this draft');
  await canAccess(pool,actor,row.mailbox_key,'read');
  if(!row.provider_message_id||!UUID.test(row.provider_message_id))
    return {verified:false,local_outcome:row.outcome||'uncertain',
      notice:'No provider ID recorded; review Resend Emails / Logs. Do not resend.'};
  const cfg=await credentialsLoader(),token=await cfg.credentialProvider();
  if(!token||!cfg.mailboxes?.[row.mailbox_key])
    throw new Error('CRM Resend access unavailable');
  let response;
  try{
    response=await fetchImpl(
      'https://api.resend.com/emails/'+row.provider_message_id,
      {method:'GET',redirect:'error',signal:AbortSignal.timeout(12000),
       headers:{Authorization:'Bearer '+token}}
    );
  }catch{
    return {verified:false,notice:'Resend status lookup unavailable. Do not resend.'};
  }
  if(response.status===404)return {verified:false,notice:
    'Resend did not find this email ID under the configured account. '
    +'Check the account/Emails logs; do not resend.'};
  if(!response.ok)return {verified:false,notice:
    'Resend lookup failed (HTTP '+String(response.status)+'). Do not resend.'};
  let record;
  try{record=await response.json();}catch{
    return {verified:false,notice:'Resend returned invalid status data.'};
  }
  // Reconcile expected immutable local identifiers before displaying status.
  const actual=Array.isArray(record?.to)?record.to:[];
  if(record?.id!==row.provider_message_id ||
     !actual.some(x=>typeof x==='string' &&
       x.trim().toLowerCase()===String(row.recipient_email).toLowerCase()) ||
     record?.subject!==row.subject)
    return {verified:false,notice:'Resend response did not match the locally '
      +'recorded recipient, subject and provider ID. No status asserted.'};
  const event=typeof record.last_event==='string'
    ?record.last_event.slice(0,48):'unknown';
  const allowed=['sent','delivered','bounced','complained','opened',
    'clicked','failed','suppressed','delivery_delayed','scheduled'];
  return {verified:true,provider_message_id:row.provider_message_id,
    last_event:allowed.includes(event)?event:'unknown',
    note:'Provider status describes Resend tracking, not a confirmed human read.'};
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


/**
 * Native Resend Inbox replies. The recipient is re-read from the provider and
 * compared to the exact saved draft before sending; Qt cannot specify the
 * actual reply target, privilege, credential, or provider mailbox ID.
 */
export function validateMailReplyRequest(input){
  const base=validateMailSendRequest(input);
  if(typeof input.mailbox!=='string'||!MAILBOXES.has(input.mailbox)
    ||typeof input.thread_id!=='string'||!UUID.test(input.thread_id)
    ||typeof input.email_id!=='string'||!UUID.test(input.email_id))
    throw new Error('CRM invalid reply conversation reference');
  return {...base,mailbox:input.mailbox,threadId:input.thread_id,
    emailId:input.email_id};
}

function senderAddress(value){
  if(typeof value!=='string'||/[\r\n\u0000]/.test(value))return null;
  const text=value.trim();
  const match=/^[^<>]*<([^<>]+)>$/.exec(text);
  const address=(match?match[1]:text).trim();
  return EMAIL.test(address)?address.toLowerCase():null;
}

export function replyRecipientFromMessage(message,ownAddress){
  if(!message||typeof message!=='object')
    throw new Error('CRM cannot resolve reply recipient');
  const to=message.reply_to;
  const candidates=Array.isArray(to)?to:
    typeof to==='string'&&to.trim()?[to]:[];
  if(candidates.length>1)
    throw new Error('CRM multiple Reply-To recipients; use a reviewed manual email');
  const raw=candidates.length?candidates[0]:message.from;
  const address=senderAddress(raw);
  if(!address||address===String(ownAddress||'').toLowerCase())
    throw new Error('CRM cannot safely resolve an external reply recipient');
  return address;
}

export async function mailReplyDraft(pool,actor,input,{
  fetchImpl=globalThis.fetch,credentialsLoader=loadPrivateResendConfig,
  listMessages=mailMessages,uuid=randomUUID}={}){
  const {draftId,revision,mailbox,threadId,emailId}=
    validateMailReplyRequest(input);
  // Re-check both rights at execution time, including the read scope.
  await canAccess(pool,actor,mailbox,'read');
  await canAccess(pool,actor,mailbox,'send');
  const current=await listMessages(pool,actor,mailbox,threadId);
  const original=(current?.items||[]).find(x=>x.id===emailId);
  if(!original)
    throw new Error('CRM reply message unavailable in current provider thread');
  const recipient=replyRecipientFromMessage(original,MAILBOXES.get(mailbox));
  const cfg=await credentialsLoader();
  const apiKey=await cfg.credentialProvider();
  if(!apiKey||!cfg.mailboxes?.[mailbox]||!UUID.test(cfg.mailboxes[mailbox]))
    throw new Error('CRM mail provider not configured');

  const scope=workspace(actor),client=await pool.connect();
  let prepared;
  try{
    await client.query('BEGIN');
    const local=(await client.query(
      'SELECT sender FROM enkyron_mail_local_messages '+
      'WHERE workspace_key=$1 AND mailbox_key=$2 AND thread_id=$3 AND message_id=$4',
      [scope,mailbox,threadId,emailId])).rows[0];
    if(!local||local.sender!==original.from)
      throw new Error('CRM reply message is not verified against the saved conversation');
    const draft=(await client.query(
      'SELECT id,revision,mailbox_key,recipient_email,subject,body_text '+
      'FROM enkyron_crm_mail_drafts WHERE workspace_key=$1 AND id=$2 FOR UPDATE',
      [scope,draftId])).rows[0];
    if(!draft||draft.revision!==revision||draft.mailbox_key!==mailbox
      ||typeof draft.body_text!=='string'||!draft.body_text.trim()
      ||typeof draft.subject!=='string'||!draft.subject.trim()
      ||String(draft.recipient_email||'').toLowerCase()!==recipient)
      throw new Error('CRM reply draft or recipient changed; review before sending');
    const access=(await client.query(
      'SELECT can_send,can_read FROM enkyron_local_mail_access '+
      'WHERE workspace_key=$1 AND mailbox_key=$2 AND role=$3',
      [scope,mailbox,'organization_owner_l5'])).rows[0];
    if(access?.can_send!==true||access?.can_read!==true)
      throw new Error('CRM mailbox reply permission not granted');
    const prior=(await client.query(
      'SELECT id FROM enkyron_mail_send_attempts '+
      'WHERE workspace_key=$1 AND draft_id=$2',[scope,draftId])).rows[0];
    if(prior)throw new Error('CRM reply already submitted; review Sent before continuing');
    const reported=(await client.query(
      'SELECT id FROM enkyron_crm_mail_manual_sends '+
      'WHERE workspace_key=$1 AND draft_id=$2',[scope,draftId])).rows[0];
    if(reported)throw new Error('CRM draft has an external send record');
    const idempotency=uuid(),attemptId=uuid();
    const request={text:draft.body_text};
    const hash=createHash('sha256').update(JSON.stringify({
      mailbox,threadId,emailId,recipient,request
    })).digest('hex');
    await client.query(
      'INSERT INTO enkyron_mail_send_attempts '+
      '(id,workspace_key,draft_id,draft_revision,mailbox_key,recipient_email,'+
      'payload_sha256,idempotency_key) VALUES($1,$2,$3,$4,$5,$6,$7,$8)',
      [attemptId,scope,draftId,revision,mailbox,recipient,hash,idempotency]
    );
    await client.query('COMMIT');
    prepared={attemptId,idempotency,request,apiKey,
      inboxId:cfg.mailboxes[mailbox]};
  }catch(error){
    await client.query('ROLLBACK').catch(()=>{});
    throw error;
  }finally{client.release();}

  const url='https://api.resend.com/inboxes/'+prepared.inboxId+
    '/threads/'+threadId+'/emails/'+emailId+'/reply';
  let providerId=null;
  try{
    const response=await fetchImpl(url,{
      method:'POST',redirect:'error',signal:AbortSignal.timeout(12000),
      headers:{Authorization:'Bearer '+prepared.apiKey,
        'Content-Type':'application/json',
        'Idempotency-Key':prepared.idempotency},
      body:JSON.stringify(prepared.request)
    });
    if(response?.ok){
      const data=await response.json();
      if(typeof data?.id==='string'&&UUID.test(data.id))
        providerId=data.id;
    }
  }catch{
    // Unknown provider outcome is intentionally NOT retried.
  }
  const outcome=providerId?'accepted':'uncertain';
  await pool.query(
    'UPDATE enkyron_mail_send_attempts SET outcome=$2,'+
    'provider_message_id=$3,completed_at=NOW() WHERE id=$1',
    [prepared.attemptId,outcome,providerId]);
  return {outcome,provider_message_id:providerId,
    notice:providerId
      ?'Resend accepted this reply in the existing thread. Delivery not confirmed.'
      :'Reply outcome uncertain. Do not resend without reviewing the provider.'};
}
