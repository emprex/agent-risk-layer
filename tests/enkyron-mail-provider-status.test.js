import test from 'node:test';
import assert from 'node:assert/strict';
import {mailCheckProviderStatus} from '../desktop/enkyron-mail-service.mjs';

const draftId='11111111-2222-4333-8444-555555555555';
const messageId='22222222-3333-4444-8555-666666666666';
const row={provider_message_id:messageId,outcome:'accepted',mailbox_key:'direction',
 recipient_email:'sam@get-zeus.com',subject:'Security assessment'};
const pool={query:async(sql,params)=>{
  if(sql.includes('FROM enkyron_mail_send_attempts s'))
    return {rows:[row]};
  if(sql.includes('enkyron_local_mail_access'))
    return {rows:[{mailbox_key:'direction',role:'organization_owner_l5',
      can_read:true,can_send:true}]};
  throw new Error('unexpected SQL query');
}};
const credentialsLoader=async()=>({
  mailboxes:{direction:{address:'guillaume.strohecker@agentrisklayer.com'}},
  credentialProvider:async()=> 'synthetic-never-network'
});
function answer(record,status=200){
  return {ok:status>=200&&status<300,status,json:async()=>record};
}
test('read-only provider check verifies exact local ID/address/subject and reports delivered',async()=>{
  const calls=[];
  const fetchImpl=async(url,options)=>{
    calls.push({url,options});
    return answer({id:messageId,to:['sam@get-zeus.com'],
      subject:'Security assessment',last_event:'delivered'});
  };
  const result=await mailCheckProviderStatus(pool,'ci-operator',draftId,{
    fetchImpl,credentialsLoader
  });
  assert.equal(result.verified,true);
  assert.equal(result.last_event,'delivered');
  assert.deepEqual(calls.map(x=>x.url),[
    'https://api.resend.com/emails/'+messageId
  ]);
  assert.equal(calls[0].options.method,'GET');
  assert.ok(!('body' in calls[0].options));
});
test('mismatched provider response does not establish delivery',async()=>{
  const result=await mailCheckProviderStatus(pool,'ci-operator',draftId,{
    fetchImpl:async()=>answer({id:messageId,to:['wrong@example.invalid'],
      subject:'Security assessment',last_event:'delivered'}),credentialsLoader
  });
  assert.equal(result.verified,false);
  assert.match(result.notice,/did not match/);
});
test('status 404 and network failures are not treated as permission to resend',async()=>{
  const missing=await mailCheckProviderStatus(pool,'ci-operator',draftId,{
    fetchImpl:async()=>answer({},404),credentialsLoader
  });
  assert.equal(missing.verified,false);
  assert.match(missing.notice,/Do not resend|do not resend/i);
  const down=await mailCheckProviderStatus(pool,'ci-operator',draftId,{
    fetchImpl:async()=>{throw new Error('network down');},credentialsLoader
  });
  assert.equal(down.verified,false);
});
test('invalid draft and missing local permission never reach provider',async()=>{
  await assert.rejects(()=>mailCheckProviderStatus(pool,'ci-operator','bad',
    {fetchImpl:async()=>{throw Error('unexpected fetch');},credentialsLoader}),/invalid/);
  const unauthorized={query:async(sql)=>{
    if(sql.includes('FROM enkyron_mail_send_attempts s'))return {rows:[row]};
    return {rows:[]};
  }};
  await assert.rejects(()=>mailCheckProviderStatus(unauthorized,'ci-operator',draftId,
    {fetchImpl:async()=>{throw Error('unexpected fetch');},credentialsLoader}),/permission/);
});
