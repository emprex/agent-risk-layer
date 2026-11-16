import test from 'node:test';
import assert from 'node:assert/strict';
import {validateRecordMove,moveSavedMailRecord,clearTrashedLocalMail} from '../desktop/enkyron-mail-record-filing.mjs';

const draft='11111111-2222-4333-8444-555555555555';
const move=(from,to)=>({draft_id:draft,from,to,confirmed:true});

test('record filing accepts explicit moves only',()=>{
 assert.deepEqual(validateRecordMove(move('sent','trash')),
  {draft_id:draft,from:'sent',to:'trash'});
 for(const invalid of [
  {...move('sent','trash'),confirmed:false},
  move('sent','sent'),move('sent','hidden'),
  move('trash','inbox'),{...move('sent','trash'),draft_id:'wrong'},
  {...move('sent','trash'),surprise:'x'}
 ])assert.throws(()=>validateRecordMove(invalid));
});

function db({sent=true,folder=null}={}){
 const calls=[];
 const client={release(){},async query(sql,params){
  calls.push({sql,params});
  if(sql.startsWith('SELECT id FROM enkyron_crm_mail_drafts'))return {rows:[{id:draft}]};
  if(sql.startsWith('SELECT (EXISTS'))return {rows:[{sent}]};
  if(sql.startsWith('SELECT folder_key FROM enkyron_mail_record_filing'))
   return {rows:folder?[{folder_key:folder}]:[]};
  if(sql.includes('RETURNING draft_id'))return {rowCount:1,rows:[{draft_id:draft}]};
  if(sql.includes('RETURNING thread_id'))return {rowCount:2,rows:[{thread_id:draft},{thread_id:draft}]};
  return {rows:[],rowCount:1};
 }};
 return {calls,connect:async()=>client};
}

test('sent to Trash preserves all underlying send/audit records',async()=>{
 const mock=db({sent:true});
 const result=await moveSavedMailRecord(mock,'ci-operator',move('sent','trash'));
 assert.equal(result.moved,true);
 assert.equal(result.provider_unchanged,true);
 assert.ok(mock.calls.some(x=>x.sql.startsWith('INSERT INTO enkyron_mail_record_filing')));
 assert.ok(mock.calls.some(x=>x.sql.startsWith('INSERT INTO enkyron_mail_record_filing_events')));
 assert.ok(!mock.calls.some(x=>/\bDELETE\b/i.test(x.sql)));
 assert.equal(mock.calls.at(-1).sql,'COMMIT');
});

test('stale source and invalid sent/draft transformation rollback',async()=>{
 for(const [options,request] of [
  [{sent:true,folder:'archive'},move('sent','trash')],
  [{sent:true},move('sent','drafts')],
  [{sent:false},move('drafts','sent')]
 ]){
  const mock=db(options);
  await assert.rejects(()=>moveSavedMailRecord(mock,'ci-operator',request));
  assert.equal(mock.calls.at(-1).sql,'ROLLBACK');
  assert.ok(!mock.calls.some(x=>x.sql.startsWith('INSERT INTO enkyron_mail_record_filing_events')));
 }
});

test('clearing local Trash requires confirmation and preserves evidence',async()=>{
 const mock=db();
 await assert.rejects(()=>clearTrashedLocalMail(mock,'ci-operator',{}));
 assert.equal(mock.calls.length,0);
 const result=await clearTrashedLocalMail(mock,'ci-operator',{confirmed:true});
 assert.equal(result.cleared,true);
 assert.equal(result.records,1);
 assert.equal(result.threads,2);
 assert.equal(result.audit_retained,true);
 assert.ok(mock.calls.some(x=>x.sql.includes("folder_key='hidden'")));
 assert.ok(!mock.calls.some(x=>/\bDELETE\b/i.test(x.sql)));
});
