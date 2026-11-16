import test from 'node:test';
import assert from 'node:assert/strict';
import {planThreadReply}
  from '../desktop/enkyron-mail-thread-recipients.mjs';

const threadId='11111111-2222-4333-8444-555555555555';
const emailId='22222222-3333-4444-8555-666666666666';

const source={
  direction:'inbound',
  from:'Customer <customer@example.com>',
  reply_to:['reply@example.com'],
  to:[
    'support@agentrisklayer.com',
    'colleague@example.com'
  ],
  cc:[
    'guillaume.strohecker@agentrisklayer.com',
    'manager@example.com'
  ],
  bcc:['original-secret@example.com']
};

const options={
  threadId,emailId,text:'Synthetic reply. Never sent.'
};

test('M03-F reply uses the verified Reply-To',()=>{
  const plan=planThreadReply(source,options);
  assert.deepEqual(plan.to,['reply@example.com']);
  assert.deepEqual(plan.cc,[]);
  assert.deepEqual(plan.bcc,[]);
});

test('M03-F Reply All excludes both operator accounts',()=>{
  const plan=planThreadReply(source,{
    ...options,replyAll:true
  });

  assert.deepEqual(plan.to,['reply@example.com']);
  assert.deepEqual(plan.cc,[
    'colleague@example.com','manager@example.com'
  ]);
});

test('M03-F never copies original BCC',()=>{
  const plan=planThreadReply(source,{
    ...options,replyAll:true
  });

  assert.deepEqual(plan.bcc,[]);
  assert.ok(!JSON.stringify(plan.provider_request)
    .includes('original-secret@example.com'));
});

test('M03-F adds reviewed CC/BCC separately',()=>{
  const plan=planThreadReply(source,{
    ...options,
    replyAll:true,
    additionalCc:['new@example.com'],
    additionalBcc:['private@example.com']
  });

  assert.deepEqual(plan.cc,[
    'colleague@example.com',
    'manager@example.com',
    'new@example.com'
  ]);
  assert.deepEqual(plan.bcc,['private@example.com']);
  assert.deepEqual(plan.provider_request.bcc,[
    'private@example.com'
  ]);
  assert.equal(plan.provider_request.reply_all,undefined);
});

test('M03-F deduplicates visible recipients',()=>{
  const plan=planThreadReply(source,{
    ...options,replyAll:true,
    additionalCc:['MANAGER@example.com']
  });
  assert.equal(plan.cc.length,2);
});

test('M03-F blocks BCC overlap',()=>{
  assert.throws(()=>planThreadReply(source,{
    ...options,replyAll:true,
    additionalBcc:['manager@example.com']
  }),/multiple recipient groups/);
});

test('M03-F refuses own addresses in added recipients',()=>{
  assert.throws(()=>planThreadReply(source,{
    ...options,
    additionalCc:['support@agentrisklayer.com']
  }),/operator mailbox/);
});

test('M03-F refuses ambiguous Reply-To and injection',()=>{
  assert.throws(()=>planThreadReply({
    ...source,reply_to:[
      'a@example.com','b@example.com'
    ]
  },options),/multiple Reply-To/);

  assert.throws(()=>planThreadReply({
    ...source,from:'evil@example.com\r\nBcc: x@example.com',
    reply_to:[]
  },options),/invalid provider address/);
});

test('M03-F confirmation fingerprint covers all recipients and text',()=>{
  const a=planThreadReply(source,options);
  const b=planThreadReply(source,{
    ...options,additionalBcc:['new@example.com']
  });
  const c=planThreadReply(source,{
    ...options,text:'Different reply text'
  });

  assert.match(a.confirmation_sha256,/^[a-f0-9]{64}$/);
  assert.notEqual(a.confirmation_sha256,b.confirmation_sha256);
  assert.notEqual(a.confirmation_sha256,c.confirmation_sha256);
});

test('M03-F rejects missing source identity and empty text',()=>{
  assert.throws(()=>planThreadReply(source,{
    ...options,emailId:'wrong'
  }));
  assert.throws(()=>planThreadReply(source,{
    ...options,text:''
  }));
});
