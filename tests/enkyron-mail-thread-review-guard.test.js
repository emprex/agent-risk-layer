import test from 'node:test';
import assert from 'node:assert/strict';

import {planThreadReply}
  from '../desktop/enkyron-mail-thread-recipients.mjs';
import {verifyThreadReplySnapshot}
  from '../desktop/enkyron-mail-thread-review-guard.mjs';

const thread='11111111-2222-4333-8444-555555555555';
const email='22222222-3333-4444-8555-666666666666';

const source={
  id:email,
  thread_id:thread,
  direction:'inbound',
  from:'Customer <customer@example.invalid>',
  reply_to:[],
  to:[
    'support@agentrisklayer.com',
    'colleague@example.invalid'
  ],
  cc:['manager@example.invalid'],
  bcc:[]
};

function setup(overrides={}){
  const options={
    threadId:thread,
    emailId:email,
    replyAll:true,
    additionalCc:['new@example.invalid'],
    additionalBcc:['private@example.invalid'],
    text:'Synthetic response. Never send.',
    ...overrides
  };
  const reviewed={
    mailbox:'support',
    ...planThreadReply(source,options)
  };
  return {
    mailbox:'support',
    source,
    reviewed,
    replyAll:options.replyAll,
    additionalCc:options.additionalCc,
    additionalBcc:options.additionalBcc,
    text:options.text
  };
}

test('verified review returns a frozen non-sending snapshot',()=>{
  const result=verifyThreadReplySnapshot(setup());

  assert.equal(result.transport_enabled,false);
  assert.equal(Object.isFrozen(result),true);
  assert.equal(Object.isFrozen(result.provider_request),true);
  assert.deepEqual(result.to,[
    'customer@example.invalid'
  ]);
  assert.deepEqual(result.cc,[
    'colleague@example.invalid',
    'manager@example.invalid',
    'new@example.invalid'
  ]);
  assert.deepEqual(result.bcc,[
    'private@example.invalid'
  ]);
});

test('rejects reply text changed after review',()=>{
  assert.throws(
    ()=>verifyThreadReplySnapshot({
      ...setup(),
      text:'Changed after approval'
    }),
    /changed; review again/
  );
});

test('rejects newly added CC after review',()=>{
  assert.throws(
    ()=>verifyThreadReplySnapshot({
      ...setup(),
      additionalCc:[
        'new@example.invalid',
        'unreviewed@example.invalid'
      ]
    }),
    /changed; review again/
  );
});

test('rejects newly added private BCC',()=>{
  assert.throws(
    ()=>verifyThreadReplySnapshot({
      ...setup(),
      additionalBcc:[
        'private@example.invalid',
        'hidden@example.invalid'
      ]
    }),
    /changed; review again/
  );
});

test('rejects changed original message recipients',()=>{
  assert.throws(
    ()=>verifyThreadReplySnapshot({
      ...setup(),
      source:{
        ...source,
        cc:['different@example.invalid']
      }
    }),
    /changed; review again/
  );
});

test('rejects changed source email identity',()=>{
  assert.throws(
    ()=>verifyThreadReplySnapshot({
      ...setup(),
      source:{
        ...source,
        id:'33333333-4444-4555-8666-777777777777'
      }
    }),
    /identity changed/
  );
});

test('rejects switching sender mailbox',()=>{
  assert.throws(
    ()=>verifyThreadReplySnapshot({
      ...setup(),
      mailbox:'direction'
    }),
    /review identity missing/
  );
});

test('rejects forged review fingerprint',()=>{
  const params=setup();
  assert.throws(
    ()=>verifyThreadReplySnapshot({
      ...params,
      reviewed:{
        ...params.reviewed,
        confirmation_sha256:'0'.repeat(64)
      }
    }),
    /changed; review again/
  );
});

test('rejects tampered BCC in a reviewed snapshot',()=>{
  const params=setup();
  assert.throws(
    ()=>verifyThreadReplySnapshot({
      ...params,
      reviewed:{
        ...params.reviewed,
        bcc:['leak@example.invalid']
      }
    }),
    /changed; review again/
  );
});

test('rejects malformed and outbound provider messages',()=>{
  assert.throws(
    ()=>verifyThreadReplySnapshot({
      ...setup(),
      source:{...source,direction:'outbound'}
    }),
    /verified inbound message/
  );

  assert.throws(
    ()=>verifyThreadReplySnapshot({
      ...setup(),
      reviewed:null
    }),
    /review identity missing/
  );
});
