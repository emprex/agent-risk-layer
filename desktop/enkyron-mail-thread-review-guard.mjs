// ENKYRON M03-H.
// Verify a previously reviewed recipient snapshot against a fresh
// authoritative provider message. NO transport, DB write or send.
import {timingSafeEqual} from 'node:crypto';
import {planThreadReply}
  from './enkyron-mail-thread-recipients.mjs';

const MAILBOXES=new Set(['direction','support']);
const SHA=/^[a-f0-9]{64}$/;

function sameHash(a,b){
  if(typeof a!=='string'||typeof b!=='string'
      ||!SHA.test(a)||!SHA.test(b))return false;
  return timingSafeEqual(
    Buffer.from(a,'hex'),Buffer.from(b,'hex')
  );
}

function equal(a,b){
  return JSON.stringify(a)===JSON.stringify(b);
}

/*
 * A reviewed snapshot is NOT authorization to send.
 * The future transport must still enforce local mailbox rights,
 * immutable PostgreSQL draft revision, explicit human confirmation,
 * provider identity, and single-attempt idempotency.
 */
export function verifyThreadReplySnapshot({
  mailbox,
  source,
  reviewed,
  replyAll=false,
  additionalCc=[],
  additionalBcc=[],
  text=''
}={}){
  if(!MAILBOXES.has(mailbox))
    throw Error('M03-H invalid mailbox');

  if(!source||typeof source!=='object'
      ||!reviewed||typeof reviewed!=='object'
      ||Array.isArray(reviewed)
      ||reviewed.mailbox!==mailbox)
    throw Error('M03-H review identity missing');

  if(source.id!==reviewed.email_id
      ||source.thread_id!==reviewed.thread_id
      ||!source.id||!source.thread_id)
    throw Error('M03-H source message identity changed');

  // Independently recompute from the fresh provider source.
  const fresh=planThreadReply(source,{
    threadId:reviewed.thread_id,
    emailId:reviewed.email_id,
    replyAll,
    additionalCc,
    additionalBcc,
    text
  });

  if(!sameHash(
      fresh.confirmation_sha256,
      reviewed.confirmation_sha256
    )
    ||!equal(fresh.to,reviewed.to)
    ||!equal(fresh.cc,reviewed.cc)
    ||!equal(fresh.bcc,reviewed.bcc)
    ||!equal(fresh.provider_request,reviewed.provider_request)){
    throw Error(
      'M03-H reply or recipients changed; review again'
    );
  }

  // Return a detached, frozen snapshot for future DB preparation.
  // Deliberately exposes NO function that can send this email.
  const request=Object.freeze({
    text:fresh.provider_request.text,
    cc:Object.freeze([...fresh.provider_request.cc]),
    bcc:Object.freeze([...fresh.provider_request.bcc])
  });

  return Object.freeze({
    mailbox,
    thread_id:fresh.thread_id,
    email_id:fresh.email_id,
    to:Object.freeze([...fresh.to]),
    cc:Object.freeze([...fresh.cc]),
    bcc:Object.freeze([...fresh.bcc]),
    provider_request:request,
    confirmation_sha256:fresh.confirmation_sha256,
    transport_enabled:false
  });
}
