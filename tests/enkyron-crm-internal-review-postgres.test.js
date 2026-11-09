import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID,createHash} from 'node:crypto';
import pg from 'pg';
import {createCompany} from '../desktop/enkyron-crm.mjs';
import {createOpportunity} from '../desktop/enkyron-crm-opportunities.mjs';
import {createProposalDraft,updateProposalDraft} from '../desktop/enkyron-crm-proposals.mjs';
import {recordCompanyProfile} from '../desktop/enkyron-company-profile.mjs';
import {recordBuyerReview} from '../desktop/enkyron-crm-buyer-review.mjs';
import {recordCommercialTerms} from '../desktop/enkyron-crm-commercial-terms.mjs';
import {recordTaxReview} from '../desktop/enkyron-crm-tax-review.mjs';
import {readInternalReview,recordInternalDecision}
  from '../desktop/enkyron-crm-internal-review.mjs';
import {readQuoteIssuePreflight} from '../desktop/enkyron-crm-quote-preflight.mjs';

const url=process.env.ARL_CI_POSTGRES_URL||'';
function disposable(){
  assert.equal(process.env.CI,'true');
  const u=new URL(url);
  assert.equal(u.hostname,'127.0.0.1');
  assert.equal(u.pathname,'/arl_ci');
  assert.equal(u.username,'arl_ci');
  assert.equal(u.password,'synthetic-ci-only');
  return url;
}
test('real PostgreSQL internal draft review: blocked, prerequisites, immutable, no issue',{
  skip:!url&&'Disposable CI PostgreSQL only',timeout:60000
},async()=>{
  const db=new pg.Pool({connectionString:disposable(),max:3});
  const actor='ci-approval-'+randomUUID().slice(0,8);
  const other=actor+'-foreign';
  try{
    const uid='usr_approval_'+randomUUID(),lead='lead_approval_'+randomUUID();
    await db.query(
      'INSERT INTO users(id,email,password_hash,created_at) VALUES($1,$2,$3,NOW())',
      [uid,'ci-approval-'+randomUUID()+'@example.invalid','synthetic']);
    await db.query(
      'INSERT INTO sales_prospects '
      +'(id,company_name,source,created_by,created_at,updated_at) '
      +'VALUES($1,$2,$3,$4,NOW(),NOW())',
      [lead,'Synthetic prospect with no legal buyer','synthetic-ci',uid]);
    const opportunity=await createOpportunity(db,{
      prospect_id:lead,company_name_at_review:'Synthetic prospect with no legal buyer',
      next_action:'Review proposed scope with an operator',due_date:'2026-12-10'
    },actor);
    const proposal=await createProposalDraft(db,{
      opportunity_id:opportunity.id,title:'Synthetic draft proposal requiring internal review',
      scope_text:'No customer order, no authorised assessments or testing.',
      currency:'GBP',amount_minor:55000
    },actor);
    const base={
      proposal_id:proposal.id,expected_revision:1,confirmed:true,
      review_note:'Missing buyer, issuer, tax research and commercial terms for the current draft.',
      decision:'internal_draft_approved'
    };
    const before=await readInternalReview(db,proposal.id,actor);
    assert.equal(before.can_approve_internal,false);
    assert.equal(before.blockers.length,4);
    await assert.rejects(()=>readInternalReview(db,proposal.id,other),/not found/);
    await assert.rejects(()=>recordInternalDecision(db,base,actor),/blocked/);
    const rejected=await recordInternalDecision(db,{...base,decision:'needs_changes'},actor);
    assert.equal(rejected.decision,'needs_changes');
    await assert.rejects(()=>recordInternalDecision(db,{
      ...base,decision:'needs_changes'},actor),/already recorded/);
    const second=await updateProposalDraft(db,{
      id:proposal.id,expected_revision:1,
      title:'Revised synthetic draft proposal for internal review',
      scope_text:'Manually proposed services, no testing or customer authorisation.',
      currency:'GBP',amount_minor:55000
    },actor);
    assert.equal(second.revision,2);
    await recordCompanyProfile(db,{
      expected_revision:0,confirmed:true,
      legal_name:'Synthetic Issuing Company Ltd',registration_number:'00000000',
      incorporation_country:'GB',
      registered_office:'10 Synthetic Office Street, Test City EX1 2AB',
      vat_status:'unknown',default_currency:'GBP',
      source_reference:'Synthetic issuing registry fixture',
      verification_notes:'Unverified synthetic business identity for a CI test only.'
    },actor);
    const company=await createCompany(db,{
      name:'Synthetic Buyer Company',legal_name:'Synthetic Buyer Company Ltd',
      city:'London',country:'GB',website:'https://example.invalid',
      sector:'Security services'
    },actor);
    await db.query(
      'INSERT INTO enkyron_crm_prospect_links '
      +'(id,workspace_key,prospect_id,company_id,source_digest,review_note,linked_by) '
      +'VALUES($1,$2,$3,$4,$5,$6,$7)',
      [randomUUID(),'local:'+actor,lead,company.id,
       createHash('sha256').update('synthetic-ci-approval-link').digest('hex'),
       'Explicit operator link of synthetic buyer to synthetic prospect.',
       actor]
    );
    const buyer=await recordBuyerReview(db,{
      proposal_id:proposal.id,company_id:company.id,expected_revision:2,
      confirmed:true,legal_name:'Synthetic Buyer Company Ltd',
      registered_address:'20 Fictional Road, London, Test Region AB1 2CD',
      source_reference:'Synthetic buyer registry',
      review_note:'Manually recorded fixture, not independently verified by ENKYRON.'
    },actor);
    const terms=await recordCommercialTerms(db,{
      proposal_id:proposal.id,expected_revision:2,confirmed:true,
      valid_until:'2099-12-31',
      payment_terms:'Payment is to be agreed in writing; no payment has been requested.',
      delivery_terms:'Delivery only after written customer authorisation and scheduling.',
      exclusions:'No live testing, exploitation, emergency response or remediation is included.',
      assumptions:'This is a synthetic record and no legally binding work has been commissioned.',
      source_reference:'Synthetic manual terms fixture'
    },actor);
    const tax=await recordTaxReview(db,{
      proposal_id:proposal.id,expected_revision:2,confirmed:true,
      buyer_type:'unknown',buyer_country:'',service_mode:'human_led_advisory',
      business_evidence:'',location_evidence:'',
      uk_vat_registration:'unknown',overseas_withholding:'not_checked',
      review_notes:'This is not a VAT determination. Human research only; tax position remains unknown.',
      source_reference:'Synthetic review fixture'
    },actor);
    const ready=await readInternalReview(db,proposal.id,actor);
    assert.equal(ready.can_approve_internal,true);
    assert.deepEqual(ready.blockers,[]);
    assert.equal(ready.current,null);
    assert.equal(ready.evidence.buyer_review_id,buyer.id);
    assert.equal(ready.evidence.terms_id,terms.id);
    assert.equal(ready.evidence.tax_review_id,tax.id);
    assert.match(ready.tax_notice,/NOT a tax determination/);
    await assert.rejects(()=>recordInternalDecision(db,{
      ...base,expected_revision:1},actor),/changed/);
    const recorded=await recordInternalDecision(db,{
      ...base,expected_revision:2,
      review_note:'Internal draft content is documented. Tax and legal reviews remain separate.'
    },actor);
    assert.equal(recorded.decision,'internal_draft_approved');
    const readback=await readInternalReview(db,proposal.id,actor);
    assert.equal(readback.current.decision,'internal_draft_approved');
    assert.deepEqual(readback.history.map(x=>x.proposal_revision),[2,1]);
    assert.equal(readback.current.buyer_review_id,buyer.id);
    assert.equal(readback.current.terms_id,terms.id);
    assert.equal(readback.current.tax_review_id,tax.id);
    const currentPreflight=await readQuoteIssuePreflight(db,proposal.id,actor);
    assert.equal(currentPreflight.steps.find(x=>
      x.label==='Internal content decision').state,'documented');
    // A later issuer edit does not erase the historical internal approval,
    // but cannot reuse that approval as a current documentary prerequisite.
    await recordCompanyProfile(db,{
      expected_revision:1,confirmed:true,
      legal_name:'Synthetic Issuing Company Ltd',registration_number:'00000000',
      incorporation_country:'GB',
      registered_office:'11 New Synthetic Office Street, Test City EX1 2AB',
      vat_status:'unknown',default_currency:'GBP',
      source_reference:'Superseding issuer fixture (not independently verified)',
      verification_notes:'Synthetic issuer revision 2 must stale the old approval evidence.'
    },actor);
    const stalePreflight=await readQuoteIssuePreflight(db,proposal.id,actor);
    assert.equal(stalePreflight.steps.find(x=>
      x.label==='Internal content decision').state,'blocked');
    assert.equal(stalePreflight.can_issue,false);
    assert.equal(stalePreflight.issue_authorised,false);
    assert.equal((await readInternalReview(db,proposal.id,actor)).current.id,recorded.id);
    await assert.rejects(()=>recordInternalDecision(db,{
      ...base,expected_revision:2,decision:'needs_changes'
    },actor),/already recorded/);
    await assert.rejects(()=>db.query(
      'UPDATE enkyron_crm_proposal_internal_decisions SET review_note=$1 WHERE id=$2',
      ['Tampered',recorded.id]),/cannot be changed or deleted/);
    await assert.rejects(()=>db.query(
      'DELETE FROM enkyron_crm_proposal_internal_decisions WHERE id=$1',
      [recorded.id]),/cannot be changed or deleted/);
    const afterProposal=(await db.query(
      'SELECT revision,amount_minor FROM enkyron_crm_proposal_drafts WHERE id=$1',
      [proposal.id]
    )).rows[0];
    assert.equal(afterProposal.revision,2);
    assert.equal(Number(afterProposal.amount_minor),55000);
  }finally{await db.end();}
});
