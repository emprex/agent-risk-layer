import test from 'node:test';
import assert from 'node:assert/strict';
import {validateRetentionReview,listRetentionReviews,recordRetentionReview} from '../desktop/enkyron-crm-retention.mjs';
const company_id='11111111-2222-4333-8444-555555555555';
const contact_id='22222222-3333-4444-8555-666666666666';
const good={company_id,contact_id,purpose_code:'service_delivery',hold_check:'not_assessed',
 next_review_on:'2027-02-01',
 review_note:'Synthetic: human reviewer to check the purpose and preservation needs.',confirmed:true};
test('retention review requires explicit human fields and rejects lifecycle actions',()=>{
 assert.equal(validateRetentionReview(good).purpose_code,'service_delivery');
 for(const bad of [
  {...good,company_id:'no'}, {...good,contact_id:'no'},
  {...good,hold_check:'approved_hold'}, {...good,purpose_code:'delete_now'},
  {...good,next_review_on:'2027-02-30'},{...good,review_note:'short'},
  {...good,review_note:'unsafe\nnote'},{...good,confirmed:false},
  {...good,delete_record:true},null,[]
 ])assert.throws(()=>validateRetentionReview(bad),/CRM/);
});
test('read history is workspace-scoped and excludes rationale and personal details',async()=>{
 const calls=[];
 const pool={query:async(sql,args)=>{
  calls.push({sql,args});
  return {rows:sql.startsWith('SELECT id,company_id FROM enkyron_crm_contacts')
   ?[{id:contact_id,company_id}]:[]};
 }};
 const x=await listRetentionReviews(pool,contact_id,'operator');
 assert.equal(x.available,true);
 assert.deepEqual(calls[0].args,['local:operator',contact_id]);
 assert.deepEqual(calls[1].args,['local:operator',company_id,contact_id]);
 assert.match(calls[1].sql,/LIMIT 51/);
 assert.doesNotMatch(calls[1].sql,/review_note|email|phone|full_name/);
});
test('recording inserts review only, no contact or ticket mutation',async()=>{
 const calls=[];
 const c={query:async(sql,args)=>{
  calls.push({sql,args});
  return {rows:sql.includes('FROM enkyron_crm_contacts')?[{id:contact_id,company_id}]:[]};
 },release(){}};
 const x=await recordRetentionReview({connect:async()=>c},good,'operator',{uuid:()=>company_id});
 assert.equal(x.contact_id,contact_id);
 assert.equal(calls.at(-1).sql,'COMMIT');
 assert.equal(calls.filter(x=>x.sql.startsWith('INSERT')).length,1);
 assert.ok(!calls.some(x=>/^(UPDATE|DELETE)/.test(x.sql)));
});
