import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import pg from 'pg';
import {createCompany,createContact} from '../desktop/enkyron-crm.mjs';
import {readCompanyCsv} from '../desktop/enkyron-crm-csv.mjs';
const url=process.env.ARL_CI_POSTGRES_URL||'';
function isolated(){
 assert.equal(process.env.CI,'true');
 const u=new URL(url);
 assert.equal(u.hostname,'127.0.0.1');
 assert.equal(u.pathname,'/arl_ci');
 assert.equal(u.username,'arl_ci');
 assert.equal(u.password,'synthetic-ci-only');
 return url;
}
test('E02-08A company+contact export respects exact operator and excludes contact details',{
 skip:!url&&'Synthetic isolated PostgreSQL only',timeout:60000
},async()=>{
 const pool=new pg.Pool({connectionString:isolated(),max:3});
 const actor='ci-csv-'+randomUUID().slice(0,8);
 try{
  const company=await createCompany(pool,{name:'Synthetic export'},actor);
  const other=await createCompany(pool,{name:'Same name, different ID'},actor);
  const contact=await createContact(pool,{
   company_id:company.id,full_name:'Synthetic Person',job_title:'Engineer',
   email:'private@example.invalid',phone:'0123456789'
  },actor);
  const received=await readCompanyCsv(pool,company.id,actor);
  assert.equal(received.available,true);
  assert.equal(received.company.name,'Synthetic export');
  assert.equal(received.contacts.length,1);
  assert.equal(received.contacts[0].id,contact.id);
  assert.equal(received.contacts[0].marketing_permission,'unknown');
  assert.ok(!JSON.stringify(received).includes('private@example.invalid'));
  assert.ok(!JSON.stringify(received).includes('0123456789'));
  assert.equal((await readCompanyCsv(pool,other.id,actor)).contacts.length,0);
  await assert.rejects(()=>readCompanyCsv(pool,company.id,'different-operator'),/not found/);
 }finally{await pool.end();}
});
