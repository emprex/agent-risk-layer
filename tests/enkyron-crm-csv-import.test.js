import test from 'node:test';
import assert from 'node:assert/strict';
import {validateCsvPreview,validateCsvCommit,inspectCsvImport,commitCsvImport}
 from '../desktop/enkyron-crm-csv-import.mjs';
const company='11111111-2222-4333-8444-555555555555';
const contact='22222222-3333-4444-8555-666666666666';
const preview={format:'ENKYRON_CRM_SELECTED_COMPANY_V1',sha256:'a'.repeat(64),
 company:{record_id:company,name:'Synthetic Import Ltd',sector:'IT',city:'London',
 country:'UK',relationship_state:'client',record_version:3},
 contacts:[{record_id:contact,name:'Synthetic Person',role:'Engineer',
 marketing_permission:'opt_in',record_version:5}],contact_count:1,read_only:true};
const input={preview,review_note:'Reviewed synthetic data and confirmed new records only without consent.',confirmed:true};
test('malformed or unsupported source fields fail closed',()=>{
 assert.equal(validateCsvPreview(preview).contacts.length,1);
 assert.equal(validateCsvCommit(input).review_note,input.review_note);
 const cases=[
  {...preview,sha256:'bad'}, {...preview,read_only:false},
  {...preview,contact_count:2}, {...preview,format:'unsafe'},
  {...preview,company:{...preview.company,record_id:'bad'}},
  {...preview,company:{...preview.company,website:'https://bad.invalid'}},
  {...preview,contacts:[{...preview.contacts[0],email:'stolen@example.invalid'}]},
  {...preview,contacts:[{...preview.contacts[0],marketing_permission:'verified'}]},
  {...preview,contacts:[...preview.contacts,preview.contacts[0]],contact_count:2},
  {...preview,contacts:[...preview.contacts,{...preview.contacts[0],
    record_id:'33333333-4444-4555-8666-777777777777',
    name:'synthetic person'}],contact_count:2}
 ];
 for(const bad of cases)assert.throws(()=>validateCsvPreview(bad),/CRM/);
 assert.throws(()=>validateCsvCommit({...input,confirmed:false}),/CRM/);
 assert.throws(()=>validateCsvCommit({...input,review_note:'short'}),/CRM/);
 assert.throws(()=>validateCsvCommit({...input,update_existing:true}),/CRM/);
});
function fake(flags={}){
 const calls=[],client={query:async(sql,args)=>{
  calls.push({sql,args});
  if(sql.includes('AS yes'))return {rows:[{yes:sql.includes('enkyron_crm_csv_import_batches')
   ?!!flags.repeated:sql.includes('lower(btrim(name))')?!!flags.sameName:!!flags.ids}]};
  return {rows:[]};
 },release(){}};
 return {db:{connect:async()=>client},calls};
}
test('read-only preview is scoped; reports collision without writing',async()=>{
 const f=fake({sameName:true});
 const result=await inspectCsvImport(f.db,preview,'ci-operator');
 assert.equal(result.eligible,false);
 assert.deepEqual(result.conflicts,['company_name_collision']);
 assert.equal(f.calls[0].sql,'BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY');
 assert.equal(f.calls.at(-1).sql,'COMMIT');
 assert.deepEqual(f.calls[1].args,['local:ci-operator',preview.sha256,company]);
 assert.equal(f.calls.some(x=>/^(UPDATE|INSERT|DELETE)/.test(x.sql)),false);
});
test('commit only inserts new records with downgraded status and consent',async()=>{
 const f=fake(),result=await commitCsvImport(f.db,input,'ci-operator');
 assert.equal(result.contact_count,1);
 assert.equal(f.calls.at(-1).sql,'COMMIT');
 assert.ok(f.calls.some(x=>x.sql.includes('pg_advisory_xact_lock')));
 const c=f.calls.find(x=>x.sql.includes('INSERT INTO enkyron_crm_companies'));
 const t=f.calls.find(x=>x.sql.includes('INSERT INTO enkyron_crm_contacts'));
 assert.match(c.sql,/'prospect','csv_reviewed_import'/);
 assert.match(t.sql,/NULL,NULL/);
 assert.ok(!JSON.stringify(t).includes('opt_in'));
 assert.ok(!JSON.stringify(t).includes('example.invalid'));
 assert.notEqual(result.company_id,company);
 assert.ok(f.calls.some(x=>x.sql.includes('INSERT INTO enkyron_crm_csv_import_batches')));
 assert.ok(f.calls.some(x=>x.sql.includes('INSERT INTO enkyron_crm_csv_import_contacts')));
 assert.ok(!f.calls.some(x=>/^(UPDATE|DELETE)/.test(x.sql)));
});
test('source collision is rejected before writes and rolled back',async()=>{
 const f=fake({repeated:true});
 await assert.rejects(()=>commitCsvImport(f.db,input,'ci-operator'),/source_already_imported/);
 assert.equal(f.calls.at(-1).sql,'ROLLBACK');
 assert.ok(!f.calls.some(x=>x.sql.startsWith('INSERT')));
});
