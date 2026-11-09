import test from 'node:test';
import assert from 'node:assert/strict';
import {validateContractReference,recordContractReference}
 from '../desktop/enkyron-crm-contract-references.mjs';
const id='11111111-2222-4333-8444-555555555555';
const sample={proposal_id:id,expected_revision:2,expected_sow_revision:1,
 document_kind:'engagement_agreement',source_reference:'synthetic-contract-ref-1',
 review_note:'Human notes the reference only; contents are not independently verified.',
 confirmed:true};
test('only known unverified document references are valid',()=>{
 assert.equal(validateContractReference(sample).document_kind,'engagement_agreement');
 for(const bad of [null,[],{}, {...sample,confirmed:false},
  {...sample,expected_revision:0},{...sample,expected_sow_revision:0},
  {...sample,proposal_id:'bad'}, {...sample,document_kind:'approved'},
  {...sample,source_reference:'x'}, {...sample,review_note:'short'},
  {...sample,authorised:true}, {...sample,source_reference:'bad\x00reference'}]){
  assert.throws(()=>validateContractReference(bad),/CRM/);
 }
});
function mock({found=true,proposalRevision=2,sowRevision=1,missingSow=false}={}){
 const calls=[];let released=false;
 const query=async(sql,params)=>{
  calls.push({sql,params});
  if(sql.startsWith('SELECT id,revision'))return {rows:found?[{id,revision:proposalRevision}]:[]};
  if(sql.startsWith('SELECT sow_revision'))return {rows:missingSow?[]:[{
    sow_revision:sowRevision,status:'operator_draft_unapproved'}]};
  return {rows:[]};
 };
 return {db:{connect:async()=>({query,release(){released=true;}})},
  calls,get released(){return released;}};
}
test('recorded claim writes once with exact version, never testing authority',async()=>{
 const m=mock();
 const result=await recordContractReference(m.db,sample,'ci-owner',{uuid:()=>id});
 assert.equal(result.evidence_status,'operator_reference_unverified');
 assert.equal(result.testing_authorised,false);
 assert.equal(result.can_sign,false);
 assert.deepEqual(m.calls.map(x=>x.sql.split(' ')[0]),['BEGIN','SELECT','SELECT','INSERT','COMMIT']);
 assert.deepEqual(m.calls[1].params,['local:ci-owner',id]);
 assert.equal(m.calls[3].params[4],1);
 assert.equal(m.calls[3].params[5],'engagement_agreement');
 assert.match(m.calls[3].params[7],/^[a-f0-9]{64}$/);
 assert.equal(m.released,true);
});
test('stale and missing documentary sources fail without inserts',async()=>{
 for(const settings of [{found:false},{proposalRevision:3},{sowRevision:2},{missingSow:true}]){
  const m=mock(settings);
  await assert.rejects(()=>recordContractReference(m.db,sample,'ci-owner'),/CRM/);
  assert.equal(m.calls.at(-1).sql,'ROLLBACK');
  assert.ok(!m.calls.some(x=>x.sql.startsWith('INSERT')));
 }
});
