import test from 'node:test';
import assert from 'node:assert/strict';
import {readCompanyCsv} from '../desktop/enkyron-crm-csv.mjs';
const id='11111111-2222-4333-8444-555555555555';
const company={id,name:'Synthetic',relationship_state:'prospect',record_version:1};
function mock({missing=false,foreign=false,tooMany=false}={}){
 const calls=[];
 const db={connect:async()=>({query:async(sql,args)=>{
  calls.push({sql,args});
  if(missing&&sql.startsWith('SELECT')){const e=new Error('schema');e.code='42P01';throw e;}
  if(sql.includes('FROM enkyron_crm_companies'))return {rows:foreign?[]:[company]};
  if(sql.includes('FROM enkyron_crm_contacts'))return {rows:tooMany?Array.from({length:501},(_,i)=>({id:String(i)})):[]};
  return {rows:[]};
 },release(){}})};
 return {db,calls};
}
test('snapshot uses consistent read-only operator-scoped SQL with minimal columns',async()=>{
 const {db,calls}=mock(),res=await readCompanyCsv(db,id,'operator');
 assert.equal(res.format,'ENKYRON_CRM_SELECTED_COMPANY_V1');
 assert.equal(res.contact_count,0);
 assert.equal(calls[0].sql,'BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
 assert.equal(calls.at(-1).sql,'COMMIT');
 for(const x of calls.filter(x=>x.args))assert.deepEqual(x.args,['local:operator',id]);
 assert.match(calls[2].sql,/LIMIT 501/);
 assert.ok(!calls.some(x=>/^(?:INSERT|UPDATE|DELETE)\b/.test(x.sql)));
 const selected=calls.filter(x=>x.sql.startsWith('SELECT')).map(x=>x.sql).join(' ');
 assert.doesNotMatch(selected,/\bemail\b|\bphone\b|review_note|client_name|draft|tax/i);
});
test('foreign company and partial export fail closed without data leak',async()=>{
 const foreign=mock({foreign:true});
 await assert.rejects(()=>readCompanyCsv(foreign.db,id,'other'),/not found/);
 assert.equal(foreign.calls.at(-1).sql,'ROLLBACK');
 const many=mock({tooMany:true});
 await assert.rejects(()=>readCompanyCsv(many.db,id,'operator'),/over 500/);
 assert.equal(many.calls.at(-1).sql,'ROLLBACK');
 const missing=mock({missing:true});
 assert.equal((await readCompanyCsv(missing.db,id,'operator')).available,false);
});
test('IDs and actor validated before opening DB',async()=>{
 const x=mock();
 await assert.rejects(()=>readCompanyCsv(x.db,'no','operator'),/CRM/);
 await assert.rejects(()=>readCompanyCsv(x.db,id,'other person'),/CRM/);
 assert.equal(x.calls.length,0);
});
