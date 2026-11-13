import test from 'node:test';
import assert from 'node:assert/strict';
import pg from 'pg';
import {randomUUID} from 'node:crypto';
import {createCompany,createContact} from '../desktop/enkyron-crm.mjs';
import {recordRetentionReview,listRetentionReviews} from '../desktop/enkyron-crm-retention.mjs';
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
test('E02-07B append-only scoped review and no source changes',{
 skip:!url&&'Disposable CI PostgreSQL only',timeout:60000
},async()=>{
 const pool=new pg.Pool({connectionString:disposable(),max:3});
 const actor='ci-retention-'+randomUUID().slice(0,8);
 try{
  const a=await createCompany(pool,{name:'Synthetic Retention A'},actor);
  const b=await createCompany(pool,{name:'Synthetic Retention B'},actor);
  const contact=await createContact(pool,{company_id:a.id,full_name:'Synthetic Case',
    email:'person@example.invalid'},actor);
  const outside=await createContact(pool,{company_id:b.id,full_name:'Unrelated Case'},actor);
  const before=(await pool.query('SELECT * FROM enkyron_crm_contacts WHERE id=$1',
    [contact.id])).rows[0];
  const input={company_id:a.id,contact_id:contact.id,purpose_code:'service_delivery',
    hold_check:'potential_hold',next_review_on:'2027-02-01',
    review_note:'Synthetic review: assess preservation requirements before any lifecycle action.',
    confirmed:true};
  const saved=await recordRetentionReview(pool,input,actor);
  const list=await listRetentionReviews(pool,contact.id,actor);
  assert.equal(list.items.length,1);
  assert.equal(list.items[0].hold_check,'potential_hold');
  assert.equal(list.items[0].next_review_on instanceof Date,true);
  assert.ok(!JSON.stringify(list).includes('person@example.invalid'));
  assert.ok(!JSON.stringify(list).includes(input.review_note));
  assert.equal((await listRetentionReviews(pool,outside.id,actor)).items.length,0);
  await assert.rejects(()=>listRetentionReviews(pool,contact.id,'another-actor'),/not found/);
  await assert.rejects(()=>recordRetentionReview(pool,input,'another-actor'),/not found/);
  await assert.rejects(()=>recordRetentionReview(pool,{...input,company_id:b.id},actor),/mismatch/);
  await assert.rejects(()=>pool.query(
    'DELETE FROM enkyron_crm_retention_reviews WHERE id=$1',[saved.id]),
    /cannot be changed or deleted/);
  await assert.rejects(()=>pool.query(
    "UPDATE enkyron_crm_retention_reviews SET hold_check='not_assessed' WHERE id=$1",[saved.id]),
    /cannot be changed or deleted/);
  assert.deepEqual((await pool.query('SELECT * FROM enkyron_crm_contacts WHERE id=$1',
    [contact.id])).rows[0],before);
  assert.equal(before.marketing_permission,'unknown');
 }finally{await pool.end();}
});
