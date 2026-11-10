// ENKYRON Mail R01 — isolated Resend Inboxes read adapter.
// NOT connected to desktop IPC, not an authentication service, not a mail sender.
// An eventual trusted owner service must resolve the principal and supply the
// OAuth access token and mailbox mapping; never accept these from a Qt payload.
// No HTML rendering, attachment downloads, mail mutations, or PostgreSQL writes.
import {ownerMailboxPermission} from './enkyron-owner-mail-access.mjs';

const UUID=/^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/i;
const MAILBOX_NAMES=['direction','support'];
const API_ORIGIN='https://api.resend.com';
function requireUuid(value){
  if(typeof value!=='string'||!UUID.test(value))
    throw new Error('Invalid Resend resource identifier');
  return value;
}
function safeText(value,max){
  if(typeof value!=='string')return '';
  // Plain-text only: HTML is ignored and bidi controls are removed.
  return value.replace(/[\u202a-\u202e\u2066-\u2069\u0000]/g,'').slice(0,max);
}
function pageLimit(value){
  if(!Number.isSafeInteger(value)||value<1||value>50)
    throw new Error('Invalid mail page size');
  return value;
}
function normalizeList(value,limit){
  if(!value||!Array.isArray(value.data)||typeof value.has_more!=='boolean'
      ||value.data.length>limit)throw new Error('Resend returned an invalid list');
  return value;
}
function validatePrincipal(principal,organizationId){
  // The principal MUST be produced by a future trusted authentication service.
  // An OS username, self-declared profile, or caller-supplied IPC identity is NOT enough.
  if(!ownerMailboxPermission(principal,organizationId,'direction','read'))
    throw new Error('Owner authentication required');
}
export function createResendInboxReader({organizationId,mailboxes,credentialProvider,
  fetchImpl=globalThis.fetch}={}){
  if(typeof organizationId!=='string'||!organizationId.trim()
      ||!mailboxes||typeof mailboxes!=='object'||Array.isArray(mailboxes)
      ||typeof credentialProvider!=='function'||typeof fetchImpl!=='function')
    throw new Error('Missing trusted mail configuration');
  const configured={};
  for(const name of MAILBOX_NAMES){
    configured[name]=requireUuid(mailboxes[name]);
  }
  if(configured.direction.toLowerCase()===configured.support.toLowerCase())
    throw new Error('Resend mailboxes must be distinct');
  const organisation=organizationId;
  async function get(path,principal,limit){
    validatePrincipal(principal,organisation);
    let token;
    try{token=await credentialProvider();}catch{
      throw new Error('Resend connection unavailable');
    }
    if(typeof token!=='string'||!token.trim()||/\s/.test(token))
      throw new Error('Resend connection unavailable');
    let response;
    try{
      response=await fetchImpl(new URL(path,API_ORIGIN),{
        method:'GET',
        headers:{Authorization:`Bearer ${token}`},
        signal:AbortSignal.timeout(8000),
        redirect:'error',
      });
    }catch{
      throw new Error('Resend connection unavailable');
    }
    if(!response?.ok){
      const status=Number.isInteger(response?.status)?response.status:0;
      throw new Error('Resend inbox read failed (HTTP '+status+')');
    }
    let body;
    try{body=await response.json();}catch{throw new Error('Resend returned invalid JSON');}
    return normalizeList(body,limit);
  }
  function choose(mailbox){
    if(!MAILBOX_NAMES.includes(mailbox))throw new Error('Unknown mailbox');
    return configured[mailbox];
  }
  return Object.freeze({
    async listThreads({principal,mailbox,limit=30,after=null}={}){
      const inbox=choose(mailbox),count=pageLimit(limit);
      if(!ownerMailboxPermission(principal,organisation,mailbox,'read'))
        throw new Error('Mailbox access denied');
    const query=new URLSearchParams({folders:'inbox',limit:String(count)});
    if(after!==null)query.set('after',requireUuid(after));
    const payload=await get(`/inboxes/${inbox}/threads?${query}`,principal,count);
      return {mailbox,items:payload.data.map(item=>({
        id:requireUuid(item.id),
        subject:safeText(item.subject,400),
        // Preserve only known display-safe fields, never HTML or raw headers.
        last_message_at:safeText(item.last_message_at,64),
        unread:item.read===false,
      })),has_more:payload.has_more};
    },
    async listThreadEmails({principal,mailbox,threadId,limit=30,after=null}={}){
      const inbox=choose(mailbox),thread=requireUuid(threadId),count=pageLimit(limit);
      if(!ownerMailboxPermission(principal,organisation,mailbox,'read'))
        throw new Error('Mailbox access denied');
      const query=new URLSearchParams({limit:String(count)});
    if(after!==null)query.set('after',requireUuid(after));
    const payload=await get(`/inboxes/${inbox}/threads/${thread}/emails?${query}`,principal,count);
    return {mailbox,thread_id:thread,items:payload.data.map(item=>({
        id:requireUuid(item.id),
        subject:safeText(item.subject,400),
        from:safeText(item.from,254),
        to:Array.isArray(item.to)?item.to.slice(0,20).map(x=>safeText(x,254)):[],
        text:safeText(item.text,20000),
        created_at:safeText(item.created_at,64),
        html_only:!item.text&&typeof item.html==='string',
      })),has_more:payload.has_more};
    },
  });
}
