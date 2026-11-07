import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import pg from 'pg';
import {createCompany,listCompanies,listContacts} from '../desktop/enkyron-crm.mjs';
import {inspectCsvImport,commitCsvImport} from '../desktop/enkyron-crm-csv-import.mjs';
const url=process.env.ARL_CI_POSTGRES_URL||'';
function disposable(){
 assert.equal(process.env.CI,'true');
 const v=new URL(url);
 assert.equal(v.hostname,'127.0.0.1');
 assert.equal(v.pathname,'/arl_ci');
 assert.equal(v.username,'arl_ci');
 assert.equal(v.password,'synthetic-ci-only');
 return url;
}
test('E02-08C atomic reviewed import, immutable provenance, conflict and rollback',{
 skip:!url&&'Disposable CI PostgreSQL only',timeout:60000
},async()=>{
 const pool=new pg.Pool({connectionString:disposable(),max:3});
 const operator='ci-csv-'+randomUUID().slice(0,8);
 const name='Synthetic CSV '+randomUUID().slice(0,8);
 const sourceCompany=randomUUID(),sourceContact=randomUUID();
 const preview={format:'ENKYRON_CRM_SELECTED_COMPANY_V1',
  sha256:randomUUID().replaceAll('-','').padEnd(64,'a'),
  company:{record_id:sourceCompany,name,sector:'IT',city:'London',country:'UK',
    relationship_state:'client',record_version:4},
  contacts:[{record_id:sourceContact,name:'Synthetic CSV Person',role:'Engineer',
    marketing_permission:'opt_in',record_version:2}],contact_count:1,read_only:true};
 const rationale='Synthetic human review: new CRM entries only, no consent or customer verification.';
 const submit=(p=preview)=>({preview:p,review_note:rationale,confirmed:true});
 try{
  assert.equal((await inspectCsvImport(pool,preview,operator)).eligible,true);
  const ticketCount=(await pool.query('SELECT count(*)::int AS n FROM arl_workbench_tickets')).rows[0].n;
  const result=await commitCsvImport(pool,submit(),operator);
  const data=(await listCompanies(pool,name,operator)).items;
  assert.equal(data.length,1);
  assert.equal(data[0].id,result.company_id);
  assert.equal(data[0].source_type,'csv_reviewed_import');
  assert.equal(data[0].relationship_state,'prospect');
  const contacts=(await listContacts(pool,result.company_id,operator)).items;
  assert.equal(contacts.length,1);
  assert.equal(contacts[0].marketing_permission,'unknown');
  assert.equal(contacts[0].relationship_state,'unverified');
  assert.equal(contacts[0].email,null);
  assert.equal(contacts[0].phone,null);
  assert.notEqual(contacts[0].id,sourceContact);
  const batch=(await pool.query(
   'SELECT source_sha256,source_company_id,destination_company_id,imported_contact_count,review_note '
   +'FROM enkyron_crm_csv_import_batches WHERE id=$1',[result.batch_id])).rows[0];
  assert.equal(batch.source_company_id,sourceCompany);
  assert.equal(batch.source_sha256,preview.sha256);
  assert.equal(batch.destination_company_id,result.company_id);
  assert.equal(batch.imported_contact_count,1);
  assert.equal(batch.review_note,rationale);
  const item=(await pool.query(
   'SELECT source_contact_id,destination_contact_id '
   +'FROM enkyron_crm_csv_import_contacts WHERE batch_id=$1',[result.batch_id])).rows[0];
  assert.equal(item.source_contact_id,sourceContact);
  assert.equal(item.destination_contact_id,contacts[0].id);
  const audit=(await pool.query(
   "SELECT count(*)::int AS n FROM enkyron_crm_events WHERE workspace_key=$1 "
   +"AND event_type='created' AND resource_id=ANY($2::text[])",
   ['local:'+operator,[result.company_id,contacts[0].id]])).rows[0];
  assert.equal(audit.n,2);
  assert.equal((await pool.query('SELECT count(*)::int AS n FROM arl_workbench_tickets')).rows[0].n,ticketCount);
  assert.equal((await listCompanies(pool,name,'other-operator')).items.length,0);
  const repeat=await inspectCsvImport(pool,preview,operator);
  assert.equal(repeat.eligible,false);
  assert.ok(repeat.conflicts.includes('source_already_imported'));
  await assert.rejects(()=>commitCsvImport(pool,submit(),operator),/source_already_imported/);
  const otherDigest={...preview,sha256:'b'.repeat(64)};
  await assert.rejects(()=>commitCsvImport(pool,submit(otherDigest),operator),/source_already_imported|company_name_collision|source_identity_collision/);
  await assert.rejects(()=>pool.query(
   'DELETE FROM enkyron_crm_csv_import_batches WHERE id=$1',[result.batch_id]),
   /cannot be changed or deleted/);
  await assert.rejects(()=>pool.query(
   'DELETE FROM enkyron_crm_csv_import_contacts WHERE batch_id=$1',[result.batch_id]),
   /cannot be changed or deleted/);

  const failingName='Synthetic Rollback '+randomUUID().slice(0,8);
  const failing={...preview,sha256:'c'.repeat(64),
   company:{...preview.company,record_id:randomUUID(),name:failingName},
   contacts:[{...preview.contacts[0],record_id:randomUUID(),name:'Rollback Synthetic Contact'}]};
  let count=0;
  const broken=()=>{if(++count>3)throw new Error('Synthetic injected failure');return randomUUID()};
  await assert.rejects(()=>commitCsvImport(pool,submit(failing),operator,{uuid:broken}),
    /Synthetic injected failure/);
  assert.equal((await listCompanies(pool,failingName,operator)).items.length,0);
  assert.equal((await pool.query(
   'SELECT count(*)::int AS n FROM enkyron_crm_csv_import_batches WHERE source_sha256=$1',
   [failing.sha256])).rows[0].n,0);
  await createCompany(pool,{name:'Known name'},operator);
  const nameConflict={...failing,sha256:'d'.repeat(64),
    company:{...failing.company,record_id:randomUUID(),name:'  KNOWN NAME  '},
    contacts:[],contact_count:0};
  assert.ok((await inspectCsvImport(pool,nameConflict,operator)).conflicts.includes('company_name_collision'));
 }finally{await pool.end();}
});
