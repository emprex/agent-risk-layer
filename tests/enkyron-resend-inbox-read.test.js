import test from 'node:test';
import assert from 'node:assert/strict';
import {createResendInboxReader} from '../desktop/enkyron-resend-inbox-read.mjs';

const org='org:01234567-89ab-cdef-0123-456789abcdef';
const direction='11111111-1111-4111-8111-111111111111';
const support='22222222-2222-4222-8222-222222222222';
const thread='bed11232-01bb-4abd-a332-512c92261ff1';
const email='34a0888b-4ddb-4abd-bba4-9f3e73687c20';
const owner={verified:true,status:'active',loginName:'ceo',role:'organization_owner_l5',
  principalId:'operator-owner',personId:'person-owner',organizationId:org};
function setup(fetchImpl,seen){
  return createResendInboxReader({organizationId:org,mailboxes:{direction,support},
    credentialProvider:async()=>{seen.tokenCalls++;return 'fake-test-token';},
    fetchImpl:async(url,options)=>{seen.calls.push({url:String(url),options});return fetchImpl(url,options);}
  });
}

test('verified Owner can list direction threads using GET only',async()=>{
  const seen={tokenCalls:0,calls:[]};
  const reader=setup(async()=>({ok:true,json:async()=>({data:[
    {id:thread,subject:'Customer request',read:false,html:'<script>evil</script>'}
  ],has_more:false})}),seen);
  const out=await reader.listThreads({principal:owner,mailbox:'direction'});
  assert.equal(out.items[0].subject,'Customer request');
  assert.equal(out.items[0].unread,true);
  assert.equal(JSON.stringify(out).includes('<script>'),false);
  assert.equal(new URL(seen.calls[0].url).pathname,'/inboxes/'+direction+'/threads');
  assert.equal(seen.calls[0].options.method,'GET');
  assert.equal(seen.calls[0].options.redirect,'error');
  assert.equal(seen.tokenCalls,1);
});

test('Owner guard rejects pending, unverified, wrong org and nonowner before credentials',async()=>{
  const seen={tokenCalls:0,calls:[]};
  const reader=setup(async()=>{throw Error('unexpected network');},seen);
  for(const principal of [
    null,{...owner,verified:false},{...owner,status:'pending'},
    {...owner,organizationId:'org:other'},{...owner,role:'service_desk_l1'}
  ])await assert.rejects(reader.listThreads({principal,mailbox:'direction'}),/Owner authentication required/);
  assert.equal(seen.tokenCalls,0);
  assert.equal(seen.calls.length,0);
});

test('rejects unknown inboxes, bad cursors, oversized pages without touching credentials',async()=>{
  const seen={tokenCalls:0,calls:[]};
  const reader=setup(async()=>{throw Error('unexpected network');},seen);
  for(const options of [
    {mailbox:'all'},{mailbox:'../../admin'}, {mailbox:'direction',after:'bad'},
    {mailbox:'direction',limit:500}
  ])await assert.rejects(reader.listThreads({principal:owner,...options}));
  assert.equal(seen.tokenCalls,0);
});

test('thread messages show only plain text, ignoring hostile HTML',async()=>{
  const seen={tokenCalls:0,calls:[]};
  const reader=setup(async()=>({ok:true,json:async()=>({data:[{
    id:email,from:'example@client.test',subject:'Assessment',
    to:['support@agentrisklayer.com'],text:'Hello\u202e client',
    html:'<img src="https://malicious.invalid/tracker">'}],has_more:false})}),seen);
  const out=await reader.listThreadEmails({principal:owner,mailbox:'support',threadId:thread});
  assert.equal(out.items[0].text,'Hello client');
  assert.equal(JSON.stringify(out).includes('malicious.invalid'),false);
  assert.equal(new URL(seen.calls[0].url).pathname,'/inboxes/'+support+'/threads/'+thread+'/emails');
});

test('provider failures do not leak token or response body',async()=>{
  const seen={tokenCalls:0,calls:[]};
  const reader=setup(async()=>({ok:false,status:403,text:async()=> 'untrusted error body'}),seen);
  await assert.rejects(reader.listThreads({principal:owner,mailbox:'support'}),err=>{
    assert.match(err.message,/HTTP 403/);
    assert.equal(err.message.includes('fake-test-token'),false);
    assert.equal(err.message.includes('untrusted error body'),false);
    return true;
  });
});

test('rejects malformed provider list and duplicate inbox IDs',async()=>{
  const seen={tokenCalls:0,calls:[]};
  const reader=setup(async()=>({ok:true,json:async()=>({data:[],has_more:'false'})}),seen);
  await assert.rejects(reader.listThreads({principal:owner,mailbox:'support'}),/invalid list/);
  assert.throws(()=>createResendInboxReader({organizationId:org,
    mailboxes:{direction,support:direction},credentialProvider:async()=>''}),/distinct/);
});
