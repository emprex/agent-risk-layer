
// ENKYRON: real cross-folder conversations, read-only.
// Match RFC Message-ID against actual In-Reply-To / References.
// Subject and addresses narrow candidates but NEVER establish identity.
import {loadPrivateResendConfig} from './enkyron-mail-private-config.mjs';
import {localMailMessages} from './enkyron-mail-local.mjs';
import {OWNER_MAILBOXES} from './enkyron-owner-mail-access.mjs';

const UUID=/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i;
const MAILBOXES=new Map(OWNER_MAILBOXES.map(x=>[x.key,x.address]));

function mailbox(value){
  if(!MAILBOXES.has(value))throw Error('Invalid Mail account');
  return value;
}
function uuid(value){
  if(typeof value!=='string'||!UUID.test(value))
    throw Error('Invalid conversation identity');
  return value;
}
function owner(actor){
  if(typeof actor!=='string'||!/^[A-Za-z0-9_.-]{1,80}$/.test(actor))
    throw Error('Invalid Mail operator');
  return 'local:'+actor;
}
function address(value){
  if(typeof value!=='string')return '';
  const match=/<([^<>]+)>\s*$/.exec(value.trim());
  const mail=(match?match[1]:value).trim().toLowerCase();
  return /^[^\s@<>;,]+@[^\s@<>;,]+\.[^\s@<>;,]+$/.test(mail)
    ?mail:'';
}
function topic(value){
  return String(value||'').trim()
    .replace(/^(?:(?:re|aw|sv):\s*)+/i,'')
    .trim().toLowerCase();
}
function messageId(value){
  if(typeof value!=='string')return null;
  const trimmed=value.trim();
  return /^<[^<>\s]{3,250}>$/.test(trimmed)?trimmed:null;
}

// Only two RFC headers can prove reply ancestry.
export function referencesFromHeaders(headers){
  if(!headers||typeof headers!=='object'||Array.isArray(headers))
    return [];
  const values=[];
  for(const [name,value] of Object.entries(headers)){
    if(!['in-reply-to','references'].includes(name.toLowerCase())
       ||typeof value!=='string'||value.length>16000)continue;
    values.push(...(value.match(/<[^<>\s]{3,250}>/g)||[]));
  }
  return [...new Set(values)];
}
export function isReplyTo(message_id,headers){
  const exact=messageId(message_id);
  return exact!==null&&referencesFromHeaders(headers).includes(exact);
}
function chronological(items){
  return [...items].sort((a,b)=>{
    const x=Date.parse(a.created_at||'');
    const y=Date.parse(b.created_at||'');
    return (Number.isFinite(x)?x:0)-(Number.isFinite(y)?y:0);
  }).slice(0,50);
}
async function permission(pool,key,account){
  const result=(await pool.query(
    'SELECT can_read FROM enkyron_local_mail_access '+
    'WHERE workspace_key=$1 AND mailbox_key=$2 '+
    "AND role='organization_owner_l5'",
    [key,account]
  )).rows[0];
  if(result?.can_read!==true)
    throw Error('Mailbox permission denied');
}
async function get(token,path){
  const response=await fetch('https://api.resend.com'+path,{
    method:'GET',
    redirect:'error',
    headers:{Authorization:'Bearer '+token},
    signal:AbortSignal.timeout(10000)
  });
  if(!response.ok)throw Error('Provider lookup unavailable');
  const raw=await response.json();
  return raw?.data&&typeof raw.data==='object'
    ?raw.data:raw;
}
async function receivedReferences(token,record,expectedSender,subject){
  if(!UUID.test(String(record.id||'')))return [];
  const raw=await get(token,'/emails/receiving/'+record.id);
  if(raw?.id!==record.id ||
     address(raw.from)!==expectedSender ||
     topic(raw.subject)!==subject)
    return [];
  return referencesFromHeaders(raw.headers);
}
async function sentIdentity(token,record,account){
  if(!UUID.test(String(record.provider_message_id||'')))return null;
  const raw=await get(token,'/emails/'+record.provider_message_id);
  if(raw?.id!==record.provider_message_id ||
     address(raw.from)!==address(MAILBOXES.get(account)) ||
     !Array.isArray(raw.to) ||
     !raw.to.some(to=>address(to)===address(record.recipient_email)) ||
     topic(raw.subject)!==topic(record.subject))
    return null;
  return messageId(raw.message_id);
}
function sentCard(row,account){
  return {
    id:row.provider_message_id,
    from:MAILBOXES.get(account),
    to:[row.recipient_email],
    subject:row.subject,
    text:row.body_text,
    created_at:new Date(row.recorded_at).toISOString(),
    html_only:false,
    attachment_count:0,
    attachment_previews:[],
    direction:'outbound'
  };
}
async function credentials(){
  const config=await loadPrivateResendConfig();
  return config.credentialProvider();
}
async function sentMatches(pool,key,account,correspondents,subject){
  if(!correspondents.length||!subject)return [];
  const rows=(await pool.query(
    'SELECT s.provider_message_id,s.recipient_email,s.recorded_at,'+
    'd.subject,d.body_text FROM enkyron_mail_send_attempts s '+
    'JOIN enkyron_crm_mail_drafts d '+
    'ON d.workspace_key=s.workspace_key AND d.id=s.draft_id '+
    "WHERE s.workspace_key=$1 AND s.mailbox_key=$2 "+
    "AND s.outcome='accepted' AND s.provider_message_id IS NOT NULL "+
    'AND LOWER(s.recipient_email)=ANY($3::text[]) '+
    'AND LOWER(d.subject)=LOWER($4) '+
    'ORDER BY s.recorded_at DESC LIMIT 15',
    [key,account,correspondents,subject]
  )).rows;
  return rows.filter(row=>UUID.test(String(row.provider_message_id||'')));
}

async function inboxConversation(pool,actor,input){
  const account=mailbox(input.mailbox);
  const thread=uuid(input.thread_id);
  const key=owner(actor);
  await permission(pool,key,account);

  const saved=await localMailMessages(pool,actor,{
    mailbox:account,thread_id:thread
  });

  const incoming=Array.isArray(saved.items)?saved.items:[];
  const base={...saved,items:incoming,linked:false};
  if(!incoming.length)return base;

  const correspondent=[...new Set(incoming.map(m=>address(m.from))
    .filter(a=>a&&a!==address(MAILBOXES.get(account))))];
  const subject=topic(incoming[0].subject);
  if(!correspondent.length||!subject)return base;

  const candidates=await sentMatches(
    pool,key,account,correspondent,subject
  );
  if(!candidates.length)return base;

  try{
    const token=await credentials();
    const refLists=await Promise.allSettled(
      incoming.slice(0,8).map(record=>
        receivedReferences(
          token,record,address(record.from),subject
        )
      )
    );
    const references=new Set(refLists.flatMap(r=>
      r.status==='fulfilled'?r.value:[]
    ));
    if(!references.size)return base;

    const results=await Promise.allSettled(
      candidates.map(async row=>({
        row,
        id:await sentIdentity(token,row,account)
      }))
    );
    const matches=results.filter(r=>
      r.status==='fulfilled' &&
      r.value.id &&
      references.has(r.value.id)
    ).map(r=>r.value.row);

    // An ambiguous correlation never silently merges conversations.
    if(matches.length!==1)return base;

    return {
      ...base,
      linked:true,
      items:chronological([
        sentCard(matches[0],account),...incoming
      ])
    };
  }catch{
    // Provider unavailable: preserve the already readable Inbox.
    return base;
  }
}
async function sentConversation(pool,actor,input){
  const key=owner(actor);
  const draftId=uuid(input.draft_id);

  const row=(await pool.query(
    'SELECT s.provider_message_id,s.recipient_email,s.recorded_at,'+
    's.mailbox_key,d.subject,d.body_text '+
    'FROM enkyron_mail_send_attempts s '+
    'JOIN enkyron_crm_mail_drafts d '+
    'ON d.workspace_key=s.workspace_key AND d.id=s.draft_id '+
    "WHERE s.workspace_key=$1 AND s.draft_id=$2 "+
    "AND s.outcome='accepted' AND s.provider_message_id IS NOT NULL",
    [key,draftId]
  )).rows[0];

  if(!row||!UUID.test(String(row.provider_message_id||'')))
    return {linked:false,items:[]};

  const account=mailbox(row.mailbox_key);
  await permission(pool,key,account);
  const correspondent=address(row.recipient_email);
  if(!correspondent||!topic(row.subject))
    return {linked:false,items:[]};

  const incoming=(await pool.query(
    'SELECT m.thread_id,m.message_id AS id,m.sender AS "from",'+
    'm.subject FROM enkyron_mail_local_messages m '+
    'WHERE m.workspace_key=$1 AND m.mailbox_key=$2 '+
    "AND LOWER(m.subject)=LOWER($3) "+
    "AND LOWER(m.sender) LIKE ('%' || $4 || '%') "+
    'ORDER BY m.created_at DESC LIMIT 16',
    [key,account,'Re: '+row.subject,correspondent]
  )).rows;

  if(!incoming.length)return {linked:false,items:[]};

  try{
    const token=await credentials();
    const sentId=await sentIdentity(token,row,account);
    if(!sentId)return {linked:false,items:[]};

    const matches=await Promise.allSettled(
      incoming.map(async record=>{
        const refs=await receivedReferences(
          token,record,correspondent,topic(row.subject)
        );
        return refs.includes(sentId)?String(record.thread_id):null;
      })
    );
    const threads=[...new Set(matches.flatMap(r=>
      r.status==='fulfilled'&&r.value?[r.value]:[]
    ))];
    if(threads.length!==1)return {linked:false,items:[]};

    const saved=await localMailMessages(pool,actor,{
      mailbox:account,thread_id:threads[0]
    });
    const messages=Array.isArray(saved.items)?saved.items:[];
    if(!messages.length)return {linked:false,items:[]};

    return {
      linked:true,
      mailbox:account,
      thread_id:threads[0],
      items:chronological([sentCard(row,account),...messages])
    };
  }catch{
    return {linked:false,items:[]};
  }
}

export async function mergedMailConversation(pool,actor,input){
  if(!input||typeof input!=='object'||Array.isArray(input))
    throw Error('Invalid conversation request');
  if(input.draft_id!==undefined)
    return sentConversation(pool,actor,input);
  return inboxConversation(pool,actor,input);
}
