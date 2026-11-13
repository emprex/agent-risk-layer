import test from 'node:test';
import assert from 'node:assert/strict';
import {readQuoteIssuePreflight} from '../desktop/enkyron-crm-quote-preflight.mjs';
const id='11111111-2222-4333-8444-555555555555';
const company='22222222-3333-4444-8555-666666666666';
function fixture({active=true,buyerCompany=company,fee='75000',lines='75000',
  valid=true,decision='internal_draft_approved',found=true,
  issuerId=id,buyerId=id,termsId=id,taxId=id,
  // Immutable approval references remain at the original IDs while
  // the current source changes: this is the stale-source test condition.
  approvedIssuerId=id,approvedBuyerId=id,
  approvedTermsId=id,approvedTaxId=id}={}){
  const calls=[];
  const rows=sql=>{
    if(sql.includes('JOIN enkyron_crm_opportunities o'))return found?[{
      id,revision:2,title:'Synthetic security quote',currency:'GBP',
      amount_minor:fee,company_id:company,buyer_company_id:company,
      effective_origin:active
    }]:[];
    if(sql.includes('FROM enkyron_operator_company_profiles'))return [{id:issuerId}];
    if(sql.includes('FROM enkyron_crm_proposal_buyer_reviews'))
      return [{id:buyerId,company_id:buyerCompany,review_status:'operator_documented_unverified'}];
    if(sql.includes('FROM enkyron_crm_proposal_commercial_terms'))
      return [{id:termsId,review_status:'operator_draft_unapproved',valid_now:valid}];
    if(sql.includes('FROM enkyron_crm_proposal_tax_reviews'))return [{id:taxId}];
    if(sql.includes('FROM enkyron_crm_proposal_internal_decisions'))
      return [{id,decision,issuer_profile_id:approvedIssuerId,
        buyer_review_id:approvedBuyerId,terms_id:approvedTermsId,
        tax_review_id:approvedTaxId}];
    if(sql.includes('FROM enkyron_crm_proposal_lines'))return [{n:1,total:lines}];
    return [];
  };
  return {calls,pool:{connect:async()=>({
    query:async(sql,params)=>{calls.push({sql,params});return {rows:rows(sql)};},
    release:()=>calls.push({sql:'RELEASE'})
  })}};
}
test('preflight cannot issue even with complete draft evidence; read-only SQL',async()=>{
  const x=fixture(),r=await readQuoteIssuePreflight(x.pool,id,'emprex');
  assert.equal(r.status,'blocked_not_issuable');
  assert.equal(r.can_issue,false);
  assert.equal(r.issue_authorised,false);
  assert.equal(r.proposal_revision,2);
  assert.equal(r.steps.length,7);
  assert.ok(r.steps.every(x=>x.state==='documented'));
  assert.ok(r.blockers.some(x=>x.includes('NOT IMPLEMENTED')));
  assert.equal(x.calls[0].sql,'BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
  assert.deepEqual(x.calls[1].params,['local:emprex',id]);
  assert.equal(x.calls.at(-2).sql,'COMMIT');
  assert.ok(x.calls.every(x=>!/^\s*(INSERT|UPDATE|DELETE|ALTER)\b/i.test(x.sql)));
  assert.doesNotMatch(JSON.stringify(r),/registered_address|company_utr/);
});
test('revoked source, changed buyer, price drift, old terms and review denial block',async()=>{
  for(const [opts,label] of [
    [{active:false},'Reviewed client association'],
    [{buyerCompany:id},'Buyer documentary review'],
    [{lines:'74999'},'Itemised price'],
    [{valid:false},'Commercial terms'],
    [{decision:'needs_changes'},'Internal content decision']
  ]){
    const r=await readQuoteIssuePreflight(fixture(opts).pool,id,'emprex');
    assert.equal(r.can_issue,false);
    assert.equal(r.steps.find(x=>x.label===label).state,'blocked');
  }
});
test('invalid IDs and foreign workspaces fail closed',async()=>{
  const x=fixture({found:false});
  await assert.rejects(()=>readQuoteIssuePreflight(x.pool,id,'other'),/not found/);
  assert.deepEqual(x.calls[1].params,['local:other',id]);
  assert.equal(x.calls.at(-2).sql,'ROLLBACK');
  await assert.rejects(()=>readQuoteIssuePreflight(x.pool,'invalid','emprex'),/invalid proposal ID/);
  await assert.rejects(()=>readQuoteIssuePreflight(x.pool,id,'bad actor'),/invalid local operator/);
});

test('superseded references never count as current approval in quote preflight',async()=>{
  const other='99999999-8888-4777-8666-555555555555';
  for(const stale of [
    {issuerId:other},{buyerId:other},{termsId:other},{taxId:other}
  ]){
    const r=await readQuoteIssuePreflight(fixture(stale).pool,id,'emprex');
    assert.equal(r.steps.find(x=>x.label==='Internal content decision').state,'blocked');
    assert.equal(r.can_issue,false);
    assert.equal(r.issue_authorised,false);
  }
  const current=fixture();
  const out=await readQuoteIssuePreflight(current.pool,id,'emprex');
  assert.equal(out.steps.find(x=>x.label==='Internal content decision').state,'documented');
  assert.ok(current.calls.find(x=>x.sql.includes('FROM enkyron_crm_proposal_tax_reviews')).sql
    .includes('ORDER BY recorded_at DESC,id DESC LIMIT 1'));
  assert.ok(current.calls.every(x=>!/^(INSERT|UPDATE|DELETE)/.test(x.sql)));
});
