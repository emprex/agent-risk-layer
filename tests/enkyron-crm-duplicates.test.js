import test from 'node:test';
import assert from 'node:assert/strict';
import {previewCompanyDuplicates,previewContactDuplicates}
 from '../desktop/enkyron-crm-duplicates.mjs';
const cid='11111111-2222-4333-8444-555555555555';
function fake(rows=[]){
 const calls=[];
 const client={query:async(sql,args)=>{calls.push({sql,args});
  if(sql.startsWith('SELECT id FROM enkyron_crm_companies'))return {rows:[{id:cid}]};
  return {rows:sql.startsWith('SELECT')?rows:[]};
 },release(){}};
 return {pool:{connect:async()=>client},calls};
}
test('company preflight: bounded, workspace-scoped, no writes or automatic merge',async()=>{
 const rows=Array.from({length:26},(_,i)=>({id:String(i),name:'Test',
  name_match:true,legal_name_match:false,domain_match:true}));
 const x=fake(rows);
 const result=await previewCompanyDuplicates(x.pool,{name:'Test Company',
  website:'https://www.example.invalid/path'},'synthetic');
 assert.equal(result.available,true);
 assert.equal(result.kind,'company');
 assert.equal(result.matches.length,25);
 assert.equal(result.more,true);
 assert.equal(x.calls[0].sql,'BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY');
 assert.equal(x.calls.at(-1).sql,'COMMIT');
 assert.deepEqual(x.calls[1].args,['local:synthetic','Test Company','','example.invalid']);
 assert.match(x.calls[1].sql,/LIMIT 26/);
 assert.match(x.calls[1].sql,/workspace_key=\$1/);
 assert.ok(x.calls.every(q=>!/^(INSERT|UPDATE|DELETE)/.test(q.sql)));
});
test('contact preflight never exposes stored emails and refuses absent or cross-scope company',async()=>{
 const x=fake([{id:'existing',full_name:'Example',company_id:cid,company_name:'Firm',
   name_same_company:true,email_same_workspace:false}]);
 const result=await previewContactDuplicates(x.pool,{company_id:cid,full_name:'Example',
  email:'person@example.invalid'},'synthetic');
 assert.equal(result.matches.length,1);
 assert.equal(result.company_id,cid);
 assert.equal(x.calls[0].sql,'BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY');
 assert.deepEqual(x.calls[1].args,['local:synthetic',cid]);
 assert.deepEqual(x.calls[2].args,['local:synthetic',cid,'Example','person@example.invalid']);
 assert.doesNotMatch(x.calls[2].sql,/SELECT .*ct\.email/);
 assert.match(x.calls[2].sql,/LIMIT 26/);
 assert.equal(x.calls.at(-1).sql,'COMMIT');
 await assert.rejects(()=>previewContactDuplicates(x.pool,{
  company_id:cid,full_name:'Example'},'bad operator'),/invalid local operator/);
 const missing={connect:async()=>({query:async(sql)=>({
  rows:sql.startsWith('SELECT')?[]:[]}),release(){}})};
 await assert.rejects(()=>previewContactDuplicates(missing,{
  company_id:cid,full_name:'Example'},'synthetic'),/not found/);
});
test('invalid input rejected before any SQL',async()=>{
 const x=fake();
 await assert.rejects(()=>previewCompanyDuplicates(x.pool,{name:'',website:''},'synthetic'),/required/);
 await assert.rejects(()=>previewContactDuplicates(x.pool,{
  company_id:'unsafe',full_name:'Bad'},'synthetic'),/identifier/);
 assert.equal(x.calls.length,0);
});
