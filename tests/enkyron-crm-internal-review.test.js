import test from 'node:test';
import assert from 'node:assert/strict';
import {validateInternalDecision,readInternalReview,recordInternalDecision}
  from '../desktop/enkyron-crm-internal-review.mjs';
const id='11111111-2222-4333-8444-555555555555';
const base={proposal_id:id,expected_revision:2,confirmed:true,
 decision:'needs_changes',
 review_note:'Rework the buyer and pricing details before any further internal approval.'};
test('internal review rejects malformed requests and no human confirmation',()=>{
 assert.equal(validateInternalDecision(base).decision,'needs_changes');
 for(const bad of [null,{},[],{...base,confirmed:false},
 {...base,proposal_id:'invalid'},{...base,expected_revision:0},
 {...base,decision:'issue_quote'},{...base,decision:'approved'},
 {...base,review_note:'short'},
 {...base,review_note:'foo'+String.fromCharCode(0)+'bar'}]){
   assert.throws(()=>validateInternalDecision(bad),/CRM/);
 }
});
function mock({missing=[],revision=2,existing=false,hasProposal=true,
 current=null,issuerId='issuer-1',taxId='tax-1',termsValid=true,
 effectiveOrigin=true,bindingCompany='company-1',reviewedCompany='company-1'}={}){
 const queries=[];let released=false;
 const proposal={id,revision,title:'Synthetic internal draft',amount_minor:'50000',currency:'GBP'};
 const rows={
  enkyron_operator_company_profiles:{id:issuerId,revision:1,legal_name:'Synthetic Ltd'},
  enkyron_crm_proposal_buyer_reviews:{id:'buyer-1',company_id:reviewedCompany,
    review_status:'operator_documented_unverified'},
  enkyron_crm_proposal_commercial_terms:{id:'terms-1',valid_until:'2099-01-01',still_valid:termsValid},
  enkyron_crm_proposal_tax_reviews:{id:taxId,buyer_type:'unknown',uk_vat_registration:'unknown'}
 };
 const query=async(sql,params)=>{
  queries.push({sql,params});
  if(sql.startsWith('SELECT id,revision,title,amount_minor'))return {rows:hasProposal?[proposal]:[]};
  if(sql.startsWith('SELECT COALESCE(o.company_id'))
    return {rows:[{buyer_company_id:bindingCompany,effective_origin:effectiveOrigin}]};
  if(sql.startsWith('SELECT id FROM enkyron_crm_proposal_internal_decisions'))
    return {rows:existing?[{id:'previous'}]:[]};
  if(sql.startsWith('SELECT id,proposal_revision,decision,review_note'))
    return {rows:current?[current]:[]};
  for(const [table,row] of Object.entries(rows)){
   if(sql.includes('FROM '+table+' '))return {rows:missing.includes(table)?[]:[row]};
  }
  return {rows:[]};
 };
 return {db:{connect:async()=>({query,release:()=>{released=true;}})},queries,
  get released(){return released;}};
}
test('preflight is read-only, scoped and lists missing documents',async()=>{
 const m=mock({missing:['enkyron_crm_proposal_buyer_reviews']});
 const r=await readInternalReview(m.db,id,'ci-operator');
 assert.equal(r.can_approve_internal,false);
 assert.match(r.blockers.join(' '),/buyer/i);
 assert.equal(r.current,null);
 assert.deepEqual(m.queries[1].params,['local:ci-operator',id]);
 assert.ok(m.queries[0].sql.includes('READ ONLY'));
 assert.equal(m.queries.at(-1).sql,'COMMIT');
 assert.equal(m.released,true);
});
test('needs_changes is recorded despite blockers; approval requires current evidence',async()=>{
 const m=mock({missing:['enkyron_crm_proposal_buyer_reviews']});
 const result=await recordInternalDecision(m.db,base,'ci-operator',{uuid:()=>id});
 assert.equal(result.decision,'needs_changes');
 assert.equal(m.queries.at(-1).sql,'COMMIT');
 assert.ok(!m.queries.some(x=>/^\s*(UPDATE|DELETE)\b/.test(x.sql)));
 const a=mock({missing:['enkyron_crm_proposal_buyer_reviews']});
 await assert.rejects(()=>recordInternalDecision(a.db,{
  ...base,decision:'internal_draft_approved'},'ci-operator'),/blocked/);
 assert.equal(a.queries.at(-1).sql,'ROLLBACK');
 assert.ok(!a.queries.some(x=>x.sql.startsWith('INSERT')));
 const b=mock();
 const approved=await recordInternalDecision(b.db,{
  ...base,decision:'internal_draft_approved'},'ci-operator',{uuid:()=>id});
 assert.equal(approved.decision,'internal_draft_approved');
 const insert=b.queries.find(x=>x.sql.startsWith('INSERT'));
 assert.equal(insert.params[1],'local:ci-operator');
 assert.deepEqual(insert.params.slice(6,10),['issuer-1','buyer-1','terms-1','tax-1']);
 for(const c of [{revision:3},{existing:true},{hasProposal:false}]){
   const x=mock(c);
   await assert.rejects(()=>recordInternalDecision(x.db,base,'ci-operator'),/CRM/);
   assert.equal(x.queries.at(-1).sql,'ROLLBACK');
 }
});

test('immutable internal decision is identified as stale when documentary IDs change',async()=>{
  const approved={id:'review-1',proposal_revision:2,
    decision:'internal_draft_approved',review_note:'Historical synthetic review',
    issuer_profile_id:'issuer-1',buyer_review_id:'buyer-1',
    terms_id:'terms-1',tax_review_id:'tax-1',recorded_by:'ci-operator'};
  const normal=mock({current:approved});
  const a=await readInternalReview(normal.db,id,'ci-operator');
  assert.equal(a.current_documentary_status,'recorded_references_match');
  assert.equal(a.current.id,'review-1');
  for(const changes of [
    {issuerId:'issuer-2'},{taxId:'tax-2'},{termsValid:false},
    {missing:['enkyron_crm_proposal_buyer_reviews']}
  ]){
    const m=mock({current:approved,...changes});
    const r=await readInternalReview(m.db,id,'ci-operator');
    assert.equal(r.current_documentary_status,'recorded_references_stale');
    assert.equal(r.current.id,'review-1');
    assert.equal(r.history[0].decision,'internal_draft_approved');
    assert.equal(m.queries[0].sql,'BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
    assert.equal(m.queries.at(-1).sql,'COMMIT');
    assert.ok(m.queries.every(x=>!/^(INSERT|UPDATE|DELETE)\b/.test(x.sql)));
  }
  const pending=await readInternalReview(mock().db,id,'ci-operator');
  assert.equal(pending.current_documentary_status,'not_recorded');
  const needs=await readInternalReview(mock({current:{
    ...approved,decision:'needs_changes'
  }}).db,id,'ci-operator');
  assert.equal(needs.current_documentary_status,'not_approved');
});

test('revoked or mismatched client association blocks new internal content approval',async()=>{
 for(const changed of [
   {effectiveOrigin:false},
   {bindingCompany:'different-company'},
   {reviewedCompany:'different-company'},
   {bindingCompany:null}
 ]){
   const reviewed=mock(changed);
   const preview=await readInternalReview(reviewed.db,id,'ci-operator');
   assert.equal(preview.can_approve_internal,false);
   assert.match(preview.blockers.join(' '),/effective reviewed client association/);
   assert.ok(reviewed.queries.some(x=>x.sql.startsWith('SELECT COALESCE(o.company_id')
     &&x.params[0]==='local:ci-operator'&&x.params[1]===id));
   const approval=mock(changed);
   await assert.rejects(()=>recordInternalDecision(approval.db,{
     ...base,decision:'internal_draft_approved'
   },'ci-operator'),/blocked/);
   assert.equal(approval.queries.at(-1).sql,'ROLLBACK');
   assert.ok(!approval.queries.some(x=>x.sql.startsWith('INSERT')));
   const correction=mock(changed);
   const saved=await recordInternalDecision(correction.db,base,'ci-operator',{uuid:()=>id});
   assert.equal(saved.decision,'needs_changes');
 }
 const oldReview={id:'review-1',proposal_revision:2,
   decision:'internal_draft_approved',
   issuer_profile_id:'issuer-1',buyer_review_id:'buyer-1',
   terms_id:'terms-1',tax_review_id:'tax-1',recorded_by:'ci-operator'};
 const historical=await readInternalReview(mock({
   current:oldReview,effectiveOrigin:false
 }).db,id,'ci-operator');
 assert.equal(historical.current.id,'review-1');
 assert.equal(historical.current_documentary_status,'recorded_references_stale');
});
