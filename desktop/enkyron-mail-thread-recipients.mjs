/*
 * ENKYRON M03-F: recipient plan for an existing Resend thread.
 * Pure computation: no provider POST, database mutation or email sending.
 */
import {createHash} from 'node:crypto';
import {
  mailAddress,validateRecipientGroups
} from './enkyron-mail-recipient-policy.mjs';

const OWN=[
  'guillaume.strohecker@agentrisklayer.com',
  'support@agentrisklayer.com'
];
const UUID=/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i;

function providerAddress(value){
  if(typeof value!=='string'||value.length>512||
      /[\x00-\x1f\x7f]/.test(value))
    throw Error('M03 invalid provider address');
  const raw=value.trim();
  const match=/^[^<>]*<([^<>]+)>$/.exec(raw);
  if((raw.includes('<')||raw.includes('>'))&&!match)
    throw Error('M03 ambiguous provider address');
  return mailAddress(match?match[1]:raw);
}

function providerList(value){
  if(value==null)return [];
  if(typeof value==='string')return [value];
  if(Array.isArray(value)&&value.length<=50)return value;
  throw Error('M03 invalid provider address list');
}

function addedList(value,label){
  if(!Array.isArray(value)||value.length>50)
    throw Error('M03 invalid additional '+label);
  return value.map(mailAddress);
}

export function planThreadReply(message,options={}){
  if(!message||typeof message!=='object'||Array.isArray(message)
      ||message.direction!=='inbound')
    throw Error('M03 requires a verified inbound message');

  const {
    threadId,emailId,replyAll=false,
    additionalCc=[],additionalBcc=[],text=''
  }=options;

  if(!UUID.test(threadId||'')||!UUID.test(emailId||'')
      ||typeof replyAll!=='boolean')
    throw Error('M03 invalid conversation reference');

  if(typeof text!=='string'||!text.trim()||
      Buffer.byteLength(text,'utf8')>12000)
    throw Error('M03 invalid reply text');

  const replyTo=providerList(message.reply_to);
  if(replyTo.length>1)
    throw Error('M03 multiple Reply-To addresses require manual review');

  const primary=providerAddress(
    replyTo.length?replyTo[0]:message.from
  );
  const own=new Set(OWN);
  if(own.has(primary))
    throw Error('M03 reply primary is an operator mailbox');

  const cc=[];
  const seen=new Set([primary]);

  function addCc(raw,fromOperator=false){
    const address=fromOperator?mailAddress(raw):providerAddress(raw);

    if(own.has(address)){
      if(fromOperator)
        throw Error('M03 cannot add an operator mailbox to CC');
      return;
    }
    if(seen.has(address))return;
    seen.add(address);
    cc.push(address);
  }

  if(replyAll){
    // Only provider-visible To/CC can be reviewed.
    // Never copy the original message's BCC.
    for(const address of [
      ...providerList(message.to),
      ...providerList(message.cc)
    ])addCc(address);
  }

  for(const address of addedList(additionalCc,'CC'))
    addCc(address,true);

  const bcc=addedList(additionalBcc,'BCC');
  if(bcc.some(address=>own.has(address)))
    throw Error('M03 cannot add an operator mailbox to BCC');

  const recipients=validateRecipientGroups({
    to:[primary],cc,bcc
  });

  // Resend derives To from the original email's Reply-To/From.
  // Do not set reply_all=true: that could copy unreviewed addresses.
  const providerRequest={
    text,
    cc:recipients.cc,
    bcc:recipients.bcc
  };

  const confirmationSha256=createHash('sha256')
    .update(JSON.stringify({
      threadId,emailId,replyAll,
      recipients,providerRequest
    })).digest('hex');

  return {
    thread_id:threadId,
    email_id:emailId,
    to:recipients.to,
    cc:recipients.cc,
    bcc:recipients.bcc,
    provider_request:providerRequest,
    confirmation_sha256:confirmationSha256,
    note:'Only provider-visible original To/CC recipients were considered. '+
      'Resend may not expose the complete original To header. '+
      'The original BCC is never copied.'
  };
}
