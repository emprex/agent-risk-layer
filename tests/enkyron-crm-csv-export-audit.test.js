import test from 'node:test';
import assert from 'node:assert/strict';
import {validateExportStart,validateExportFinish,beginCsvExport,finishCsvExport,listCsvExportEvents}
 from '../desktop/enkyron-crm-csv-export-audit.mjs';
const company_id='11111111-2222-4333-8444-555555555555';
const export_id='33333333-4444-4555-8666-777777777777';
const start={company_id,company_version:2,contact_count:1,confirmed:true};
const finish={company_id,export_id,event_type:'completed',
 file_sha256:'f'.repeat(64),file_bytes:240,record_count:2};
function mock({foreign=false,version=2,count=1,terminal=false}={}){
 const calls=[];
 const client={query:async(sql,args)=>{
  calls.push({sql,args});
  if(sql.includes('SELECT id,record_version FROM enkyron_crm_companies'))
   return {rows:foreign?[]:[{id:company_id,record_version:version}]};
  if(sql.includes('SELECT count(*)::integer AS n'))return {rows:[{n:count}]};
  if(sql.includes("event_type='started' AND recorded_by"))
   return {rows:foreign?[]:[{id:export_id,company_id,company_record_version:2,expected_contact_count:1}]};
  if(sql.includes("event_type IN ('completed','failed') LIMIT 1"))
   return {rows:terminal?[{id:export_id}]:[]};
  if(sql.includes('SELECT id FROM enkyron_crm_companies'))
   return {rows:foreign?[]:[{id:company_id}]};
  return {rows:[]};
 },release(){}};
 return {db:{connect:async()=>client,query:client.query},calls};
}
test('strict start and terminal fields; unknown data refused',()=>{
 assert.equal(validateExportStart(start).company_version,2);
 assert.equal(validateExportFinish(finish).file_bytes,240);
 for(const bad of [{...start,confirmed:false},{...start,contact_count:501},
  {...start,extra:'exfiltration'}, {...start,company_version:0}])
  assert.throws(()=>validateExportStart(bad),/CRM/);
 for(const bad of [{...finish,file_sha256:'bad'}, {...finish,record_count:502},
  {...finish,file_bytes:0}, {...finish,failure_category:'wrong'},
  {...finish,export_id:'bad'}, {...finish,event_type:'approved'},
  {...finish,raw_contacts:'private'},
  {...finish,event_type:'failed',file_sha256:undefined,record_count:undefined,
   file_bytes:undefined,failure_category:'attacker-defined'}])
  assert.throws(()=>validateExportFinish(bad),/CRM/);
 assert.equal(validateExportFinish({company_id,export_id,
  event_type:'failed',failure_category:'file_error'}).event_type,'failed');
});
test('start records only an attempt after scoped version and count checks',async()=>{
 const x=mock();
 const result=await beginCsvExport(x.db,start,'operator',{uuid:()=>export_id});
 assert.equal(result.export_id,export_id);
 assert.equal(x.calls.at(-1).sql,'COMMIT');
 assert.deepEqual(x.calls[1].args,['local:operator',company_id]);
 assert.deepEqual(x.calls[2].args,['local:operator',company_id]);
 assert.equal(x.calls.filter(c=>c.sql.startsWith('INSERT')).length,1);
 assert.ok(!x.calls.some(c=>/^(UPDATE|DELETE)/.test(c.sql)));
 for(const opts of [{foreign:true},{version:3},{count:2}]){
  const y=mock(opts);
  await assert.rejects(()=>beginCsvExport(y.db,start,'operator'),
   /not found|stale|changed/);
  assert.equal(y.calls.at(-1).sql,'ROLLBACK');
  assert.ok(!y.calls.some(c=>c.sql.startsWith('INSERT')));
 }
});
test('finish requires scoped intent, expected row count and no prior final event',async()=>{
 const x=mock(),result=await finishCsvExport(x.db,finish,'operator',{uuid:()=>export_id});
 assert.equal(result.status,'completed');
 assert.equal(x.calls.at(-1).sql,'COMMIT');
 assert.ok(x.calls.some(c=>c.sql.includes('pg_advisory_xact_lock')));
 const ins=x.calls.find(c=>c.sql.startsWith('INSERT'));
 assert.deepEqual(ins.args.slice(1,5),['local:operator',export_id,company_id,'completed']);
 assert.equal(ins.args[7],finish.file_sha256);
 for(const [opts,payload] of [
  [{foreign:true},finish],[{terminal:true},finish],[{}, {...finish,record_count:3}]
 ]){
  const y=mock(opts);
  await assert.rejects(()=>finishCsvExport(y.db,payload,'operator'),
   /missing|finalized|count/);
  assert.equal(y.calls.at(-1).sql,'ROLLBACK');
  assert.ok(!y.calls.some(c=>c.sql.startsWith('INSERT')));
 }
});
test('audit read is scoped and excludes file paths or contact values',async()=>{
 const x=mock();
 const data=await listCsvExportEvents(x.db,company_id,'operator');
 assert.equal(data.available,true);
 assert.deepEqual(x.calls[0].args,['local:operator',company_id]);
 assert.deepEqual(x.calls[1].args,['local:operator',company_id]);
 assert.doesNotMatch(x.calls[1].sql,/filename|file_path|email|phone|full_name/);
 assert.match(x.calls[1].sql,/LIMIT 51/);
 const f=mock({foreign:true});
 await assert.rejects(()=>listCsvExportEvents(f.db,company_id,'other'),/not found/);
});
