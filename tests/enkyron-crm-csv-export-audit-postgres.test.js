import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import pg from 'pg';
import {createCompany,createContact} from '../desktop/enkyron-crm.mjs';
import {beginCsvExport,finishCsvExport,listCsvExportEvents} from '../desktop/enkyron-crm-csv-export-audit.mjs';
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
test('E02-08D append-only attempt/result, negative scope, duplicate receipt, no customer mutation',{
 skip:!url&&'Disposable CI PostgreSQL only',timeout:60000
},async()=>{
 const pool=new pg.Pool({connectionString:disposable(),max:3});
 const actor='ci-export-'+randomUUID().slice(0,8);
 try{
  const company=await createCompany(pool,{name:'Synthetic Audit Export'},actor);
  const contact=await createContact(pool,{
   company_id:company.id,full_name:'Synthetic CSV Identity',
   email:'private@example.invalid'},actor);
  const before=(await pool.query(
   'SELECT * FROM enkyron_crm_contacts WHERE id=$1',[contact.id])).rows[0];
  const startInput={company_id:company.id,company_version:1,contact_count:1,confirmed:true};
  await assert.rejects(()=>beginCsvExport(pool,
   {...startInput,contact_count:2},actor),/changed/);
  await assert.rejects(()=>beginCsvExport(pool,startInput,'different-operator'),/not found/);
  const started=await beginCsvExport(pool,startInput,actor);
  const complete={export_id:started.export_id,company_id:company.id,event_type:'completed',
   file_sha256:'a'.repeat(64),file_bytes:159,record_count:2};
  await assert.rejects(()=>finishCsvExport(pool,{...complete,record_count:3},actor),/count/);
  await assert.rejects(()=>finishCsvExport(pool,complete,'different-operator'),/missing/);
  const finished=await finishCsvExport(pool,complete,actor);
  assert.equal(finished.status,'completed');
  await assert.rejects(()=>finishCsvExport(pool,complete,actor),/finalized/);
  const history=await listCsvExportEvents(pool,company.id,actor);
  assert.equal(history.items.length,2);
  assert.deepEqual(history.items.map(x=>x.event_type).sort(),['completed','started']);
  assert.equal(history.items.find(x=>x.event_type==='completed').file_sha256,complete.file_sha256);
  assert.ok(!JSON.stringify(history).includes('private@example.invalid'));
  assert.ok(!JSON.stringify(history).includes('Synthetic CSV Identity'));
  await assert.rejects(()=>listCsvExportEvents(pool,company.id,'different-operator'),/not found/);
  await assert.rejects(()=>pool.query(
   'DELETE FROM enkyron_crm_csv_export_events WHERE export_id=$1',[started.export_id]),
   /cannot be changed or deleted/);
  await assert.rejects(()=>pool.query(
   "UPDATE enkyron_crm_csv_export_events SET event_type='failed' WHERE export_id=$1",
   [started.export_id]),/cannot be changed or deleted/);
  const failed=await beginCsvExport(pool,startInput,actor);
  await finishCsvExport(pool,{export_id:failed.export_id,company_id:company.id,
   event_type:'failed',failure_category:'file_error'},actor);
  await assert.rejects(()=>finishCsvExport(pool,{...complete,export_id:failed.export_id},actor),/finalized/);
  const after=(await pool.query(
   'SELECT * FROM enkyron_crm_contacts WHERE id=$1',[contact.id])).rows[0];
  assert.deepEqual(after,before);
 }finally{await pool.end();}
});
