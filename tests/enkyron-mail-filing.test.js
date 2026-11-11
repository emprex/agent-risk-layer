import test from 'node:test';
import assert from 'node:assert/strict';
import {moveMailThread,validateFiling}
  from '../desktop/enkyron-mail-filing.mjs';
import {createResendInboxReader} from '../desktop/enkyron-resend-inbox-read.mjs';

const INBOX='11111111-1111-4111-8111-111111111111';
const SUPPORT='22222222-2222-4222-8222-222222222222';
const THREAD='33333333-3333-4333-8333-333333333333';
const req={mailbox:'direction',thread_id:THREAD,
  from_folder:'inbox',to_folder:'archive',confirmed:true};
const cfg=async()=>({mailboxes:{direction:INBOX,support:SUPPORT},
  credentialProvider:async()=> 'synthetic-token'});
function fakePool(permission=true){
  const calls=[];
  const pool={query:async(sql,params=[])=>{
    calls.push({sql,params});
    if(sql.startsWith('SELECT can_manage'))return {rows:[{can_manage:permission}]};
    return {rows:[]};
  }};
  return {pool,calls};
}
function fakeFetch(calls,folder='inbox',ack=true){
  return async(url,options)=>{
    calls.push({url,options});
    if(options.method==='GET')return {
      ok:true,json:async()=>({id:THREAD,folder})
    };
    if(options.method==='PATCH')return {ok:ack};
    throw Error('unexpected provider call');
  };
}
test('Only bounded, explicitly confirmed folder operations are accepted',()=>{
  assert.deepEqual(validateFiling(req),{mailbox:'direction',
    threadId:THREAD,source:'inbox',target:'archive'});
  for(const invalid of [{...req,confirmed:false},{...req,to_folder:'sent'},
    {...req,to_folder:'inbox'},{...req,thread_id:'bad'},
    {...req,mailbox:'../secret'},{...req,from_folder:'../../etc'}])
    assert.throws(()=>validateFiling(invalid),/Mail folder change/);
});
test('Filing requires Owner can_manage and exact provider folder',async()=>{
  const denied=fakePool(false),calls=[];
  await assert.rejects(()=>moveMailThread(denied.pool,'test',req,
    {fetchImpl:fakeFetch(calls),credentialsLoader:cfg}),/permission/);
  assert.equal(calls.length,0);
  const allowed=fakePool();
  await assert.rejects(()=>moveMailThread(allowed.pool,'test',req,
    {fetchImpl:fakeFetch(calls,'spam'),credentialsLoader:cfg}),/folder changed/);
  assert.ok(calls.every(x=>x.options.method==='GET'));
  assert.equal(allowed.calls.filter(x=>x.sql.startsWith('INSERT')).length,0);
});
test('Successful archive writes request before PATCH and provider result after',async()=>{
  const {pool,calls}=fakePool(),network=[];
  let counter=0;
  const result=await moveMailThread(pool,'operator',req,
    {fetchImpl:fakeFetch(network),credentialsLoader:cfg,
      uuid:()=>String(++counter).padStart(8,'0')+'-1111-4111-8111-111111111111'});
  assert.equal(result.moved,true);
  assert.deepEqual(network.map(x=>x.options.method),['GET','PATCH']);
  assert.equal(new URL(network[0].url).pathname,
    '/inboxes/'+INBOX+'/threads/'+THREAD);
  assert.equal(JSON.parse(network[1].options.body).folder,'archive');
  const events=calls.filter(x=>x.sql.includes('INSERT INTO enkyron_mail_filing_events'));
  assert.deepEqual(events.map(x=>x.params[7]),['requested','provider_confirmed']);
  assert.equal(events[0].params[1],events[1].params[1]);
  assert.equal(calls.at(-1).params[3],'archive');
});
test('Uncertain provider response remains auditable with no automatic retry',async()=>{
  const {pool,calls}=fakePool(),network=[];
  const result=await moveMailThread(pool,'operator',req,
    {fetchImpl:fakeFetch(network,'inbox',false),credentialsLoader:cfg});
  assert.equal(result.moved,false);
  assert.equal(result.uncertain,true);
  assert.deepEqual(network.map(x=>x.options.method),['GET','PATCH']);
  assert.deepEqual(
    calls.filter(x=>x.sql.includes('INSERT INTO enkyron_mail_filing_events'))
      .map(x=>x.params[7]),['requested','provider_uncertain']);
  assert.ok(!calls.some(x=>x.sql.startsWith('UPDATE')));
});
test('Provider folder listing only uses supported folders',async()=>{
  const seen=[];
  const reader=createResendInboxReader({
    organizationId:'test',mailboxes:{direction:INBOX,support:SUPPORT},
    credentialProvider:async()=> 'synthetic-token',
    authoriseRead:()=>true,
    fetchImpl:async(url,options)=>{
      seen.push({url:String(url),options});
      return {ok:true,json:async()=>({data:[],has_more:false})};
    }
  });
  const list=await reader.listThreads({mailbox:'direction',folder:'trash'});
  assert.deepEqual(list.items,[]);
  assert.equal(new URL(seen[0].url).searchParams.get('folders'),'trash');
  await assert.rejects(
    reader.listThreads({mailbox:'direction',folder:'../../oops'}),/Invalid inbox folder/);
  assert.equal(seen.length,1);
});
