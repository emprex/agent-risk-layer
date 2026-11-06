import test from 'node:test';
import assert from 'node:assert/strict';
import {validateBillingWorksheet,readBillingPreparation,recordBillingWorksheet}
  from '../desktop/enkyron-crm-billing-worksheet.mjs';
const id='11111111-2222-4333-8444-555555555555';
const approvalId='aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee';
const base={proposal_id:id,expected_revision:2,approval_id:approvalId,
  preparation_note:'This is an unissued synthetic pre-billing worksheet without tax.',
  confirmed:true};
test('validate prebilling requires exact approval reference, confirmation, no totals or tax input',()=>{
 assert.equal(validateBillingWorksheet(base).proposal_id,id);
 assert.ok(!('vat_rate' in validateBillingWorksheet({...base,vat_rate:20})));
 for(const invalid of [null,{},[],{...base,confirmed:false},
  {...base,proposal_id:'invalid'},{...base,approval_id:'invalid'},
  {...base,expected_revision:0},{...base,preparation_note:'too short'},
  {...base,preparation_note:'a'.repeat(1501)},
  {...base,preparation_note:'abc'+String.fromCharCode(0)+' secret'}]){
  assert.throws(()=>validateBillingWorksheet(invalid),/CRM/);
 }
});
function fixture({revision=2,approved=true,approvalExists=true,prior=false,proposalExists=true}={}){
 const queries=[];let released=false;
 const proposal={id,revision,title:'Synthetic commercial draft',currency:'GBP',
   amount_minor:'50000',research_candidate:'Unverified Research Prospect'};
 const approval={id:approvalId,proposal_revision:revision,
   decision:approved?'internal_draft_approved':'needs_changes',
   issuer_profile_id:'issuer',buyer_review_id:'buyer',terms_id:'terms',tax_review_id:'tax'};
 const query=async(sql,params)=>{
  queries.push({sql,params});
  if(sql.startsWith('SELECT d.id,d.revision'))return {rows:proposalExists?[proposal]:[]};
  if(sql.startsWith('SELECT id,decision,proposal_revision'))return {rows:approvalExists?[approval]:[]};
  if(sql.startsWith('SELECT id,proposal_revision,source_approval_id'))return {rows:[]};
  if(sql.startsWith('SELECT id FROM enkyron_crm_billing_worksheets'))
   return {rows:prior?[{id:'exists'}]:[]};
  return {rows:[]};
 };
 return {db:{connect:async()=>({query,release(){released=true;}})},queries,get released(){return released;}};
}
test('read-only worksheet preflight refuses unapproved proposal and isolates workspace',async()=>{
 const m=fixture({approved:false});
 const out=await readBillingPreparation(m.db,id,'ci-operator');
 assert.equal(out.can_prepare,false);
 assert.match(out.blockers.join(' '),/approval/);
 assert.equal(out.current,null);
 assert.deepEqual(m.queries[1].params,['local:ci-operator',id]);
 assert.equal(m.queries[0].sql,'BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
 assert.equal(m.queries.at(-1).sql,'COMMIT');
 assert.equal(m.released,true);
});
test('write takes exact current revision approval; no external actions or overwrite',async()=>{
 const m=fixture();
 const r=await recordBillingWorksheet(m.db,base,'ci-operator',{uuid:()=>id});
 assert.equal(r.status,'internal_prebilling_only');
 const insert=m.queries.find(q=>q.sql.startsWith('INSERT'));
 assert.equal(insert.params[1],'local:ci-operator');
 assert.equal(insert.params[4],approvalId);
 assert.equal(insert.params[11],50000);
 assert.equal(m.queries.at(-1).sql,'COMMIT');
 assert.equal(m.queries.some(q=>/^\s*(UPDATE|DELETE)\b/.test(q.sql)),false);
 for(const opts of [{revision:3},{approved:false},{approvalExists:false},
    {prior:true},{proposalExists:false}]){
  const f=fixture(opts);
  await assert.rejects(()=>recordBillingWorksheet(f.db,base,'ci-operator'),/CRM/);
  assert.equal(f.queries.at(-1).sql,'ROLLBACK');
  assert.equal(f.queries.some(q=>q.sql.startsWith('INSERT')),false);
 }
});
