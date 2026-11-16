import test from 'node:test';
import assert from 'node:assert/strict';
import {
  prepareProfessionalMailPayload,
  professionalPayloadFingerprint
} from '../desktop/enkyron-mail-professional-payload.mjs';

const draft={
  mailbox_key:'direction',
  recipient_email:'one@example.com',
  to_recipients:['ONE@example.com','two@example.com'],
  cc_recipients:['manager@example.com'],
  bcc_recipients:['private@example.com'],
  subject:'Synthetic professional message',
  body_text:'Synthetic content. Not sent.'
};

test('M03-D preserves separate To CC and BCC',()=>{
  const payload=prepareProfessionalMailPayload(draft);

  assert.deepEqual(payload.to,[
    'one@example.com','two@example.com'
  ]);
  assert.deepEqual(payload.cc,['manager@example.com']);
  assert.deepEqual(payload.bcc,['private@example.com']);

  assert.equal(payload.from,
    'guillaume.strohecker@agentrisklayer.com');

  assert.ok(!payload.to.includes('private@example.com'));
  assert.ok(!payload.cc.includes('private@example.com'));
});

test('M03-D rejects an incorrect primary recipient',()=>{
  assert.throws(()=>prepareProfessionalMailPayload({
    ...draft,recipient_email:'someone@example.com'
  }),/mismatch/);
});

test('M03-D rejects duplicate BCC visibility',()=>{
  assert.throws(()=>prepareProfessionalMailPayload({
    ...draft,bcc_recipients:['ONE@example.com']
  }),/multiple recipient groups/);
});

test('M03-D rejects header injection and empty content',()=>{
  assert.throws(()=>prepareProfessionalMailPayload({
    ...draft,subject:'Hello\r\nBcc: attacker@example.com'
  }),/subject/);

  assert.throws(()=>prepareProfessionalMailPayload({
    ...draft,body_text:''
  }),/body/);
});

test('M03-D rejects unauthorized sending identities',()=>{
  assert.throws(()=>prepareProfessionalMailPayload({
    ...draft,mailbox_key:'other'
  }),/mailbox/);
});

test('M03-D fingerprint covers BCC and exact message body',()=>{
  const first=prepareProfessionalMailPayload(draft);
  const second=prepareProfessionalMailPayload({
    ...draft,bcc_recipients:['different@example.com']
  });
  const third=prepareProfessionalMailPayload({
    ...draft,body_text:'Changed content.'
  });

  const a=professionalPayloadFingerprint(first);
  assert.match(a,/^[a-f0-9]{64}$/);
  assert.equal(a,professionalPayloadFingerprint(first));
  assert.notEqual(a,professionalPayloadFingerprint(second));
  assert.notEqual(a,professionalPayloadFingerprint(third));
  assert.ok(!a.includes('private@example.com'));
});
