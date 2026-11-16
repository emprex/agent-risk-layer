/*
 * ENKYRON M03-D: prepare an exact professional email payload.
 * Pure functions only. No database, no network, no Resend submission.
 */
import {createHash} from 'node:crypto';
import {
  mailAddress,validateRecipientGroups
} from './enkyron-mail-recipient-policy.mjs';

const SENDERS=Object.freeze({
  direction:'guillaume.strohecker@agentrisklayer.com',
  support:'support@agentrisklayer.com'
});

export function prepareProfessionalMailPayload(draft){
  if(!draft||typeof draft!=='object'||Array.isArray(draft))
    throw Error('M03 invalid draft');

  const from=SENDERS[draft.mailbox_key];
  if(!from)throw Error('M03 invalid sending mailbox');

  const recipients=validateRecipientGroups({
    to:draft.to_recipients,
    cc:draft.cc_recipients,
    bcc:draft.bcc_recipients
  });

  if(!draft.recipient_email||
      mailAddress(draft.recipient_email)!==recipients.to[0])
    throw Error('M03 primary recipient mismatch');

  const subject=draft.subject;
  const body=draft.body_text;

  if(typeof subject!=='string'||!subject.trim()||
      subject.length>200||/[\x00-\x1f\x7f]/.test(subject))
    throw Error('M03 invalid subject');

  if(typeof body!=='string'||!body.trim()||
      body.length>20000||
      /[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/.test(body))
    throw Error('M03 invalid message body');

  return {
    from,
    to:recipients.to,
    cc:recipients.cc,
    bcc:recipients.bcc,
    subject,
    text:body
  };
}

export function professionalPayloadFingerprint(payload){
  const normalized=prepareProfessionalMailPayload({
    mailbox_key:Object.entries(SENDERS)
      .find(([,address])=>address===payload?.from)?.[0],
    recipient_email:payload?.to?.[0],
    to_recipients:payload?.to,
    cc_recipients:payload?.cc,
    bcc_recipients:payload?.bcc,
    subject:payload?.subject,
    body_text:payload?.text
  });

  return createHash('sha256')
    .update(JSON.stringify(normalized))
    .digest('hex');
}
