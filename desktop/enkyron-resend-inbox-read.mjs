// ENKYRON Mail R01 — isolated Resend Inboxes read adapter.
// NOT connected to desktop IPC, not an authentication service, not a mail sender.
// An eventual trusted owner service must resolve the principal and supply the
// OAuth access token and mailbox mapping; never accept these from a Qt payload.
// No HTML rendering, attachment downloads, mail mutations, or PostgreSQL writes.
import {ownerMailboxPermission} from './enkyron-owner-mail-access.mjs';

const UUID=/^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/i;
const MAILBOX_NAMES=['direction','support'];
const FOLDERS=new Set(['inbox','archive','spam','trash']);
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
function validatePrincipal(principal,organizationId,authoriseRead){
  if(typeof authoriseRead==='function')return;
  if(!ownerMailboxPermission(principal,organizationId,'direction','read'))
    throw new Error('Owner authentication required');
}
export function createResendInboxReader({organizationId,mailboxes,credentialProvider,
  fetchImpl=globalThis.fetch,authoriseRead}={}){
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
    validatePrincipal(principal,organisation,authoriseRead);
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
    if(limit!==null)return normalizeList(body,limit);
    if(!body||typeof body!=='object'||Array.isArray(body)
        ||Buffer.byteLength(JSON.stringify(body),'utf8')>5000000)
      throw new Error('Resend returned oversized or invalid email detail');
    return body;
  }
  function requireFolder(folder){
    if(typeof folder!=='string'||!FOLDERS.has(folder))
      throw new Error('Invalid inbox folder');
    return folder;
  }
  function choose(mailbox){
    if(!MAILBOX_NAMES.includes(mailbox))throw new Error('Unknown mailbox');
    return configured[mailbox];
  }
  return Object.freeze({
    async listThreads({principal,mailbox,folder='inbox',limit=30,after=null}={}){
      const inbox=choose(mailbox),count=pageLimit(limit);
      const safeFolder=requireFolder(folder);
      if(typeof authoriseRead==='function'
        ?authoriseRead(mailbox)!==true
        :!ownerMailboxPermission(principal,organisation,mailbox,'read'))
        throw new Error('Mailbox access denied');
    const query=new URLSearchParams({folders:safeFolder,limit:String(count)});
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
      if(typeof authoriseRead==='function'
        ?authoriseRead(mailbox)!==true
        :!ownerMailboxPermission(principal,organisation,mailbox,'read'))
        throw new Error('Mailbox access denied');
      const query=new URLSearchParams({limit:String(count)});
    if(after!==null)query.set('after',requireUuid(after));
    const payload=await get(`/inboxes/${inbox}/threads/${thread}/emails?${query}`,principal,count);
    return {mailbox,thread_id:thread,items:payload.data.map(item=>({
        id:requireUuid(item.id),
        subject:safeText(item.subject,400),
        from:safeText(item.from,254),
        to:Array.isArray(item.to)?item.to.slice(0,20).map(x=>safeText(x,254)):[],
        // Envelope reply target is displayed to a human, never auto-trusted.
        reply_to:Array.isArray(item.reply_to)
          ?item.reply_to.slice(0,10).map(x=>safeText(x,254))
          :typeof item.reply_to==='string'?[safeText(item.reply_to,254)]:[],
        // One extra character signals an over-limit body to the local
        // repository. Never silently persist a shortened email as complete.
        text:safeText(item.text,20001),
        created_at:safeText(item.received_at??item.created_at,64),
        html_only:!item.text&&typeof item.html==='string',
      })),has_more:payload.has_more};
    },
    // Trusted backend only. Never give this content directly to Qt or an LLM:
    // HTML, attachment names and headers are untrusted external bytes.
    async getThreadEmail({principal,mailbox,threadId,emailId}={}){
      const inbox=choose(mailbox),thread=requireUuid(threadId),email=requireUuid(emailId);
      if(typeof authoriseRead==='function'
        ?authoriseRead(mailbox)!==true
        :!ownerMailboxPermission(principal,organisation,mailbox,'read'))
        throw new Error('Mailbox access denied');
      const raw=await get('/inboxes/'+inbox+'/threads/'+thread+'/emails/'+email,
        principal,null);
      if(requireUuid(raw.id)!==email)
        throw new Error('Resend email identity mismatch');
      const array=(value)=>{
        if(value===null||value===undefined)return [];
        if(!Array.isArray(value)||value.length>100
            ||value.some(x=>typeof x!=='string'
              ||Buffer.byteLength(x,'utf8')>2048))
          throw new Error('Unbounded provider address list');
        return value;
      };
      const textField=(value)=>{
        if(value===null)return null;
        if(typeof value!=='string'||Buffer.byteLength(value,'utf8')>2097152)
          throw new Error('Full email body exceeds archive limit');
        return value;
      };
      const details=Array.isArray(raw.attachments)?raw.attachments:[];
      if(details.length>100)throw new Error('Too many email attachments');
      return {
        id:email, mailbox,thread_id:thread,
        rfc_message_id:safeText(raw.message_id,998),
        direction:['inbound','outbound'].includes(raw.direction)
          ?raw.direction:'unknown',
        from:safeText(raw.from,2048),
        to:array(raw.to),cc:array(raw.cc),bcc:array(raw.bcc),
        reply_to:array(raw.reply_to),
        text:Object.hasOwn(raw,'text')?textField(raw.text):undefined,
        html:Object.hasOwn(raw,'html')?textField(raw.html):undefined,
        attachments_known:Array.isArray(raw.attachments),
        attachments:details.map(a=>({
          id:requireUuid(a.id),
          filename:safeText(a.filename,512),
          content_type:safeText(a.content_type,256),
          size: Number.isSafeInteger(a.size)&&a.size>=0&&a.size<=26214400
            ?a.size:null
        }))
      };
    },
  });
}
