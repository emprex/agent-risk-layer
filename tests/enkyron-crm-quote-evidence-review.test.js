import test from 'node:test';
import assert from 'node:assert/strict';
import {validateQuoteEvidenceReview,readQuoteEvidenceReview,
  recordQuoteEvidenceReview} from '../desktop/enkyron-crm-quote-evidence-review.mjs';
const proposal='11111111-2222-4333-8444-555555555555';
const id='22222222-3333-4444-8555-666666666666';
const base={
  proposal_id:proposal,expected_revision:2,expected_previous_id:null,
  review_state:'needs_changes',review_note:'Synthetic reviewer requests independent legal and tax source verification.',
  confirmed:true
};
const submitted={...base,review_state:'submitted_for_independent_review',
  issuer_source_reference:'synthetic issuer record only',
  buyer_source_reference:'synthetic buyer record only',
  tax_source_reference:'synthetic tax memo only'};
test('validation never accepts issue or verified statuses, nor unsourced submission',()=>{
  assert.equal(validateQuoteEvidenceReview(base).issuer_source_reference,null);
  assert.equal(validateQuoteEvidenceReview(submitted).review_state,'submitted_for_independent_review');
  for(const bad of [
    null,{},[],{...base,confirmed:false},{...base,proposal_id:'wrong'},
    {...base,expected_revision:0},{...base,review_state:'approved'},
    {...base,review_state:'verified'},{...base,review_note:'too short'},
    {...base,issuer_source_reference:'no'+String.fromCharCode(0)},
    {...submitted,tax_source_reference:''},{...submitted,buyer_source_reference:'x'},
    {...base,expected_previous_id:'bad'}
  ])assert.throws(()=>validateQuoteEvidenceReview(bad),/CRM/);
  assert.equal('can_issue' in validateQuoteEvidenceReview(submitted),false);
});
function fixture({found=true,current=[],revision=2}={}){
  const calls=[];
  const client={
    async query(sql,params){
      calls.push({sql,params});
      if(sql.includes('FROM enkyron_crm_proposal_drafts'))return {rows:found?
        [{id:proposal,title:'Synthetic quote',revision,currency:'GBP',amount_minor:75000}]:[]};
      if(sql.includes('FROM enkyron_crm_quote_evidence_reviews')){
        if(sql.includes('LIMIT 21'))return {rows:current};
        return {rows:current.slice(0,1).map(x=>({id:x.id,review_state:x.review_state}))};
      }
      return {rows:[]};
    },release(){calls.push({sql:'RELEASE'});}
  };
  return {calls,pool:{connect:async()=>client}};
}
test('read is snapshot scoped, bounded, never authorises issuance',async()=>{
  const f=fixture();
  const o=await readQuoteEvidenceReview(f.pool,proposal,'operator');
  assert.equal(o.can_issue,false);
  assert.equal(o.issue_authorised,false);
  assert.equal(o.latest,null);
  assert.equal(f.calls[0].sql,'BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
  assert.deepEqual(f.calls[1].params,['local:operator',proposal]);
  assert.equal(f.calls.at(-2).sql,'COMMIT');
});
test('record requires previous cursor and exact revision, append-only',async()=>{
  const f=fixture();
  const result=await recordQuoteEvidenceReview(f.pool,base,'operator',{uuid:()=>id});
  assert.equal(result.issue_authorised,false);
  assert.equal(result.review_state,'needs_changes');
  assert.ok(f.calls.some(c=>c.sql.startsWith('INSERT INTO enkyron_crm_quote_evidence_reviews')));
  assert.ok(!f.calls.some(c=>/^(UPDATE|DELETE)/.test(c.sql)));
  assert.equal(f.calls.at(-2).sql,'COMMIT');
  const changed=fixture({current:[{id,review_state:'needs_changes'}]});
  await assert.rejects(()=>recordQuoteEvidenceReview(
    changed.pool,base,'operator'),/changed concurrently/);
  const second=await recordQuoteEvidenceReview(
    changed.pool,{...submitted,expected_previous_id:id},'operator');
  assert.equal(second.review_state,'submitted_for_independent_review');
  const stale=fixture({revision:3});
  await assert.rejects(()=>recordQuoteEvidenceReview(stale.pool,base,'operator'),
    /revision changed/);
  const foreign=fixture({found:false});
  await assert.rejects(()=>recordQuoteEvidenceReview(foreign.pool,base,'other'),/not found/);
  assert.deepEqual(foreign.calls[1].params,['local:other',proposal]);
});
