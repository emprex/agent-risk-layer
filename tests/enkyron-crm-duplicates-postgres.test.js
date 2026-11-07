import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import pg from 'pg';
import {createCompany,createContact} from '../desktop/enkyron-crm.mjs';
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
test('E02-04A: possible duplicate clues, cross-workspace denial, no mutation',{
 skip:!url&&'Only disposable PostgreSQL CI',timeout:60000
},async()=>{
 const pool=new pg.Pool({connectionString:disposable(),max:3});
 const actor='ci-dup-'+randomUUID().slice(0,8),suffix=randomUUID().slice(0,8);
 try{
  const first=await createCompany(pool,{
   name:'Synthetic Duplicate '+suffix,
   legal_name:'Synthetic Duplicate Legal '+suffix,
   website:'https://www.dedup-'+suffix+'.invalid/path'},actor);
  const target=await createCompany(pool,{name:'Unrelated Target '+suffix},actor);
  const company=await previewCompanyDuplicates(pool,{
   name:'Synthetic-Duplicate-'+suffix,website:''},actor);
  assert.equal(company.matches.length,1);
  assert.equal(company.matches[0].id,first.id);
  assert.equal(company.matches[0].name_match,true);
  const host=await previewCompanyDuplicates(pool,{
   name:'No matching name '+suffix,
   website:'https://dedup-'+suffix+'.invalid/else'},actor);
  assert.equal(host.matches.length,1);
  assert.equal(host.matches[0].id,first.id);
  assert.equal(host.matches[0].domain_match,true);
  assert.equal((await previewCompanyDuplicates(pool,{
   name:'Synthetic Duplicate '+suffix},'another-actor')).matches.length,0);
  const old=await createContact(pool,{
   company_id:first.id,full_name:'Synthetic Person '+suffix,
   email:'unique-'+suffix+'@example.invalid'},actor);
  const named=await previewContactDuplicates(pool,{
   company_id:first.id,full_name:'Synthetic-Person-'+suffix},actor);
  assert.equal(named.matches.length,1);
  assert.equal(named.matches[0].id,old.id);
  assert.equal(named.matches[0].name_same_company,true);
  const emailed=await previewContactDuplicates(pool,{
   company_id:target.id,full_name:'Different Person '+suffix,
   email:'UNIQUE-'+suffix+'@EXAMPLE.INVALID'},actor);
  assert.equal(emailed.matches.length,1);
  assert.equal(emailed.matches[0].id,old.id);
  assert.equal(emailed.matches[0].email_same_workspace,true);
  assert.equal(Object.hasOwn(emailed.matches[0],'email'),false);
  await assert.rejects(()=>previewContactDuplicates(pool,{
   company_id:target.id,full_name:'Other'},'another-actor'),/not found/);
  assert.equal((await pool.query('SELECT count(*)::int AS n FROM enkyron_crm_companies '
   +'WHERE workspace_key=$1 AND id=ANY($2::text[])',
   ['local:'+actor,[first.id,target.id]])).rows[0].n,2);
  assert.equal((await pool.query('SELECT count(*)::int AS n FROM enkyron_crm_contacts '
   +'WHERE workspace_key=$1 AND id=$2',['local:'+actor,old.id])).rows[0].n,1);
 }finally{await pool.end();}
});
