import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import pg from 'pg';
import {createCompany,createContact,listCompanies,listContacts}
 from '../desktop/enkyron-crm.mjs';
import {previewCompanyDuplicates,previewContactDuplicates}
 from '../desktop/enkyron-crm-duplicates.mjs';
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
const rationale='Independent manual review confirms two synthetic records must remain separate. No contact identity or consent is verified.';
function review(ids){return {match_ids:ids,review_note:rationale,confirmed:true};}
test('E02-04B: concurrent creates serialize; stale review refused; immutable override metadata',{
 skip:!url&&'Disposable PostgreSQL CI only',timeout:60000
},async()=>{
 const pool=new pg.Pool({connectionString:disposable(),max:6});
 const actor='ci-review-'+randomUUID().slice(0,8),code=randomUUID().slice(0,8);
 try{
  const name='Synthetic Race '+code;
  const simultaneous=await Promise.allSettled([
    createCompany(pool,{name},actor),
    createCompany(pool,{name},actor)
  ]);
  const successful=simultaneous.filter(x=>x.status==='fulfilled');
  const rejected=simultaneous.filter(x=>x.status==='rejected');
  assert.equal(successful.length,1);
  assert.equal(rejected.length,1);
  assert.match(rejected[0].reason.message,/possible duplicate/);
  const first=successful[0].value;
  assert.equal((await listCompanies(pool,name,actor)).items.length,1);
  await assert.rejects(()=>createCompany(pool,{name,duplicate_review:{
    match_ids:[],confirmed:true,review_note:rationale}},actor),/matching record IDs/);
  await assert.rejects(()=>createCompany(pool,{name,duplicate_review:{
    match_ids:[randomUUID()],confirmed:true,review_note:rationale}},actor),/changed/);
  const distinct=await createCompany(pool,{
    name,city:'Another City',duplicate_review:review([first.id])},actor);
  assert.equal(distinct.relationship_state,'prospect');
  assert.equal((await listCompanies(pool,name,actor)).items.length,2);
  const audit=(await pool.query(
    'SELECT * FROM enkyron_crm_duplicate_reviews WHERE workspace_key=$1 '
    +'AND resource_kind=$2 AND resource_id=$3',
    ['local:'+actor,'company',distinct.id])).rows[0];
  assert.deepEqual(audit.matched_record_ids,[first.id]);
  assert.equal(audit.actor_local,actor);
  assert.equal(audit.review_note,rationale);
  assert.equal((await pool.query(
    'SELECT count(*)::int AS n FROM enkyron_crm_duplicate_reviews '
    +'WHERE workspace_key=$1 AND resource_kind=$2',
    ['local:'+actor,'company'])).rows[0].n,1);
  await assert.rejects(()=>createCompany(pool,{
    name,duplicate_review:review([first.id])},actor),/matches changed/);
  await assert.rejects(()=>pool.query(
    'UPDATE enkyron_crm_duplicate_reviews SET actor_local=$1 WHERE id=$2',
    ['other',audit.id]),/cannot be changed or deleted/);
  await assert.rejects(()=>pool.query(
    'DELETE FROM enkyron_crm_duplicate_reviews WHERE id=$1',
    [audit.id]),/cannot be changed or deleted/);
  const contactName='Synthetic Contact '+code;
  const pair=await Promise.allSettled([
    createContact(pool,{company_id:first.id,full_name:contactName},actor),
    createContact(pool,{company_id:first.id,full_name:contactName},actor)
  ]);
  assert.equal(pair.filter(x=>x.status==='fulfilled').length,1);
  assert.equal(pair.filter(x=>x.status==='rejected').length,1);
  const original=pair.find(x=>x.status==='fulfilled').value;
  const secondContact=await createContact(pool,{
    company_id:first.id,full_name:contactName,
    duplicate_review:review([original.id])},actor);
  assert.equal(secondContact.marketing_permission,'unknown');
  assert.equal(secondContact.relationship_state,'unverified');
  const contactAudit=(await pool.query(
    "SELECT matched_record_ids FROM enkyron_crm_duplicate_reviews "
    +"WHERE workspace_key=$1 AND resource_kind='contact' AND resource_id=$2",
    ['local:'+actor,secondContact.id])).rows[0];
  assert.deepEqual(contactAudit.matched_record_ids,[original.id]);
  assert.equal((await listContacts(pool,first.id,actor)).items.length,2);
  assert.equal((await previewCompanyDuplicates(pool,{name},'another-actor')).matches.length,0);
  await assert.rejects(()=>previewContactDuplicates(pool,{
    company_id:first.id,full_name:contactName},'another-actor'),/not found/);
  // Audit and dedup must not modify the source names or consent.
  const originalAfter=(await pool.query(
    'SELECT full_name,marketing_permission FROM enkyron_crm_contacts WHERE id=$1',
    [original.id])).rows[0];
  assert.equal(originalAfter.full_name,contactName);
  assert.equal(originalAfter.marketing_permission,'unknown');
 } finally{await pool.end();}
});
