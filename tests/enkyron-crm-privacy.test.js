import test from 'node:test';
import assert from 'node:assert/strict';
import {validatePrivacyIntake,listPrivacyRequests,recordPrivacyRequest} from '../desktop/enkyron-crm-privacy.mjs';
const company_id='11111111-2222-4333-8444-555555555555';
const contact_id='22222222-3333-4444-8555-666666666666';
const good={company_id,contact_id,request_kind:'access',source_channel:'email',
 received_on:'2026-11-07',confirmed:true};
test('privacy intake is strictly typed and needs manual confirmation',()=>{
 assert.equal(validatePrivacyIntake(good).request_kind,'access');
 for(const bad of [{...good,contact_id:'no'},{...good,company_id:'no'},
  {...good,request_kind:'marketing'},{...good,source_channel:'sms'},
  {...good,received_on:'2026-02-30'},{...good,confirmed:false},
  {...good,marketing_permission:'opt_in'},null,[]])
  assert.throws(()=>validatePrivacyIntake(bad),/CRM/);
});
test('read is local scoped, bounded, and excludes direct contact fields',async()=>{
 const calls=[],db={query:async(sql,args)=>{
  calls.push({sql,args});
  return {rows:sql.startsWith('SELECT id,company_id FROM enkyron_crm_contacts')
   ?[{id:contact_id,company_id}]:[]};
 }};
 const x=await listPrivacyRequests(db,contact_id,'ci');
 assert.equal(x.available,true);
 assert.deepEqual(calls[0].args,['local:ci',contact_id]);
 assert.deepEqual(calls[1].args,['local:ci',company_id,contact_id]);
 assert.match(calls[1].sql,/LIMIT 51/);
 assert.doesNotMatch(calls[1].sql,/email|phone|full_name/);
});
test('intake only inserts request metadata; no source changes',async()=>{
 const calls=[];
 const client={query:async(sql,args)=>{
  calls.push({sql,args});
  return {rows:sql.includes('FROM enkyron_crm_contacts')?[{id:contact_id,company_id}]:[]};
 },release(){}};
 const result=await recordPrivacyRequest({connect:async()=>client},good,'ci',{uuid:()=>company_id});
 assert.equal(result.processing_state,'pending_human_review');
 assert.equal(calls.at(-1).sql,'COMMIT');
 assert.equal(calls.filter(c=>c.sql.startsWith('INSERT')).length,1);
 assert.ok(!calls.some(c=>/^(UPDATE|DELETE)/.test(c.sql)));
});
