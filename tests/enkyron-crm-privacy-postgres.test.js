import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import pg from 'pg';
import {createCompany,createContact} from '../desktop/enkyron-crm.mjs';
import {recordPrivacyRequest,listPrivacyRequests} from '../desktop/enkyron-crm-privacy.mjs';
const url=process.env.ARL_CI_POSTGRES_URL||'';
function disposable(){
 assert.equal(process.env.CI,'true');
 const u=new URL(url);
 assert.equal(u.hostname,'127.0.0.1');
 assert.equal(u.pathname,'/arl_ci');
 assert.equal(u.username,'arl_ci');
 assert.equal(u.password,'synthetic-ci-only');
 return url;
}
test('E02-07A immutable, scoped synthetic contact request without auto-fulfilment',{
 skip:!url&&'Isolated CI PostgreSQL only',timeout:60000
},async()=>{
 const pool=new pg.Pool({connectionString:disposable(),max:3});
 const actor='ci-privacy-'+randomUUID().slice(0,8);
 try{
  const a=await createCompany(pool,{name:'Synthetic A'},actor);
  const b=await createCompany(pool,{name:'Synthetic B'},actor);
  const contact=await createContact(pool,{company_id:a.id,full_name:'Synthetic Contact',
   email:'subject@example.invalid'},actor);
  const outsider=await createContact(pool,{company_id:b.id,full_name:'Other Contact'},actor);
  const original=(await pool.query('SELECT * FROM enkyron_crm_contacts WHERE id=$1',[contact.id])).rows[0];
  const input={company_id:a.id,contact_id:contact.id,request_kind:'erasure',
   source_channel:'email',received_on:new Date().toISOString().slice(0,10),confirmed:true};
  const recorded=await recordPrivacyRequest(pool,input,actor);
  const found=await listPrivacyRequests(pool,contact.id,actor);
  assert.equal(found.items.length,1);
  assert.equal(found.items[0].processing_state,'pending_human_review');
  assert.equal(found.items[0].request_kind,'erasure');
  assert.equal((await listPrivacyRequests(pool,outsider.id,actor)).items.length,0);
  assert.ok(!JSON.stringify(found).includes('subject@example.invalid'));
  await assert.rejects(()=>listPrivacyRequests(pool,contact.id,'other-operator'),/not found/);
  await assert.rejects(()=>recordPrivacyRequest(pool,input,'other-operator'),/not found/);
  await assert.rejects(()=>recordPrivacyRequest(pool,{...input,company_id:b.id},actor),/mismatch/);
  await assert.rejects(()=>pool.query('DELETE FROM enkyron_crm_privacy_requests WHERE id=$1',
   [recorded.id]),/cannot be changed or deleted/);
  assert.deepEqual((await pool.query('SELECT * FROM enkyron_crm_contacts WHERE id=$1',
   [contact.id])).rows[0],original);
  assert.equal(original.marketing_permission,'unknown');
 }finally{await pool.end();}
});
