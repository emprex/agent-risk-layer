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
import {recordInternalDecision} from '../desktop/enkyron-crm-internal-review.mjs';
import {readBillingPreparation,recordBillingWorksheet}
  from '../desktop/enkyron-crm-billing-worksheet.mjs';
const uri=process.env.ARL_CI_POSTGRES_URL||'';
function disposable(){
 assert.equal(process.env.CI,'true');
 const u=new URL(uri);
 assert.equal(u.hostname,'127.0.0.1');
 assert.equal(u.pathname,'/arl_ci');
 assert.equal(u.username,'arl_ci');
 assert.equal(u.password,'synthetic-ci-only');
 return uri;
}
test('billing worksheet real PG: approval gate, exact fee, isolation, immutability and no issue',{
 skip:!uri&&'Disposable isolated CI PostgreSQL only',timeout:60000
},async()=>{
 const db=new pg.Pool({connectionString:disposable(),max:3});
 const actor='ci-billing-'+randomUUID().slice(0,8),other=actor+'-foreign';
 try{
  const uid='usr_bill_'+randomUUID(),lead='lead_bill_'+randomUUID();
  await db.query(
   'INSERT INTO users(id,email,password_hash,created_at) VALUES($1,$2,$3,NOW())',
   [uid,'ci-billing-'+randomUUID()+'@example.invalid','synthetic']);
  await db.query(
   'INSERT INTO sales_prospects '
   +'(id,company_name,source,created_by,created_at,updated_at) '
   +'VALUES($1,$2,$3,$4,NOW(),NOW())',
   [lead,'Synthetic unverified billing prospect','synthetic-ci',uid]);
  const opp=await createOpportunity(db,{
   prospect_id:lead,company_name_at_review:'Synthetic unverified billing prospect',
   next_action:'Human commercial preparation; do not send invoice',due_date:'2026-12-12'
  },actor);
  const proposal=await createProposalDraft(db,{
   opportunity_id:opp.id,title:'Synthetic fee proposal for pre-billing only',
   scope_text:'A prospective service, not an authorised assessment or contract.',
   currency:'GBP',amount_minor:82550
  },actor);
  const before=await readBillingPreparation(db,proposal.id,actor);
  assert.equal(before.can_prepare,false);
  assert.equal(before.approval_id,null);
  await assert.rejects(()=>readBillingPreparation(db,proposal.id,other),/not found/);
  const note='Synthetic pre-billing ledger-free preparation; tax and issue unresolved.';
  await assert.rejects(()=>recordBillingWorksheet(db,{
   proposal_id:proposal.id,expected_revision:1,approval_id:randomUUID(),
   preparation_note:note,confirmed:true
  },actor),/requires the current internal draft approval/);

  await recordCompanyProfile(db,{
   expected_revision:0,confirmed:true,
   legal_name:'Synthetic Operator Ltd',registration_number:'00000000',
   incorporation_country:'GB',
   registered_office:'10 Fake Registry Road, Test City EX1 2AB',
   vat_status:'unknown',default_currency:'GBP',
   source_reference:'Synthetic operator registry fixture',
   verification_notes:'No registry verification, synthetic local CI data only.'
  },actor);
  const company=await createCompany(db,{
   name:'Synthetic Buyer',legal_name:'Synthetic Buyer Ltd',city:'London',
   country:'GB',website:'https://example.invalid',sector:'Security research'
  },actor);
  await db.query(
   'INSERT INTO enkyron_crm_prospect_links '
   +'(id,workspace_key,prospect_id,company_id,source_digest,review_note,linked_by) '
   +'VALUES($1,$2,$3,$4,$5,$6,$7)',
   [randomUUID(),'local:'+actor,lead,company.id,
    createHash('sha256').update('synthetic-ci-billing-link').digest('hex'),
    'Explicit synthetic prospect-to-company link for billing preparation.',actor]
  );
  await recordBuyerReview(db,{
   proposal_id:proposal.id,company_id:company.id,expected_revision:1,
   confirmed:true,legal_name:'Synthetic Buyer Ltd',
   registered_address:'15 Fictional Lane, Test City EX1 1CC',
   source_reference:'Synthetic buyer document',
   review_note:'Manually transcribed synthetic buyer name, unverified externally.'
  },actor);
  await recordCommercialTerms(db,{
   proposal_id:proposal.id,expected_revision:1,confirmed:true,
   valid_until:'2099-12-31',
   payment_terms:'Payment is subject to separate agreement; no invoice has been issued.',
   delivery_terms:'Delivery requires a signed scope and customer permission.',
   exclusions:'No security testing, live system access or remediation authorised.',
   assumptions:'Tax treatment and lawful billing remain subject to human review.',
   source_reference:'Synthetic commercial document'
  },actor);
  await recordTaxReview(db,{
   proposal_id:proposal.id,expected_revision:1,confirmed:true,
   buyer_type:'unknown',buyer_country:'',service_mode:'human_led_advisory',
   business_evidence:'',location_evidence:'',
   uk_vat_registration:'unknown',overseas_withholding:'not_checked',
   review_notes:'No VAT determination, even for this synthetic prospect or transaction.',
   source_reference:'Synthetic tax research only'
  },actor);
  const approved=await recordInternalDecision(db,{
   proposal_id:proposal.id,expected_revision:1,confirmed:true,
   decision:'internal_draft_approved',
   review_note:'Internal content only was reviewed; tax and legal issue authority remain unresolved.'
  },actor);
  const preflight=await readBillingPreparation(db,proposal.id,actor);
  assert.equal(preflight.can_prepare,true);
  assert.equal(preflight.approval_id,approved.id);
  assert.equal(preflight.proposed_fee_minor,82550);
  assert.equal(preflight.current,null);
  await assert.rejects(()=>recordBillingWorksheet(db,{
   proposal_id:proposal.id,expected_revision:1,approval_id:randomUUID(),
   preparation_note:note,confirmed:true
  },actor),/requires the current internal draft approval/);
  const initial=await recordBillingWorksheet(db,{
   proposal_id:proposal.id,expected_revision:1,approval_id:approved.id,
   preparation_note:note,confirmed:true
  },actor);
  assert.equal(initial.status,'internal_prebilling_only');
  const r=await readBillingPreparation(db,proposal.id,actor);
  assert.equal(r.current.status,'internal_prebilling_only');
  assert.equal(Number(r.current.proposed_fee_minor),82550);
  assert.equal(r.current.preparation_note,note);
  assert.equal(r.history.length,1);
  assert.ok(!('invoice_number' in r.current));
  assert.ok(!('vat_amount' in r.current));
  const stored=(await db.query(
   'SELECT * FROM enkyron_crm_billing_worksheets WHERE id=$1',[initial.id]
  )).rows[0];
  assert.equal(stored.source_approval_id,approved.id);
  assert.equal(stored.proposal_revision,1);
  await assert.rejects(()=>recordBillingWorksheet(db,{
   proposal_id:proposal.id,expected_revision:1,approval_id:approved.id,
   preparation_note:note,confirmed:true
  },actor),/already recorded/);
  await assert.rejects(()=>db.query(
   'UPDATE enkyron_crm_billing_worksheets SET preparation_note=$1 WHERE id=$2',
   ['Tampered',initial.id]),/cannot be changed or deleted/);
  await assert.rejects(()=>db.query(
   'DELETE FROM enkyron_crm_billing_worksheets WHERE id=$1',[initial.id]
  ),/cannot be changed or deleted/);
  const second=await updateProposalDraft(db,{
   id:proposal.id,expected_revision:1,
   title:'Revised synthetic pre-billing draft for test',
   scope_text:'Still no customer approval, billing authority or assessment.',
   currency:'GBP',amount_minor:90000
  },actor);
  assert.equal(second.revision,2);
  const changed=await readBillingPreparation(db,proposal.id,actor);
  assert.equal(changed.can_prepare,false);
  assert.equal(changed.current,null);
  assert.equal(changed.history[0].proposal_revision,1);
  await assert.rejects(()=>recordBillingWorksheet(db,{
   proposal_id:proposal.id,expected_revision:1,approval_id:approved.id,
   preparation_note:note,confirmed:true
  },actor),/proposal changed/);
  const untouched=(await db.query(
   'SELECT proposed_fee_minor,proposal_revision FROM enkyron_crm_billing_worksheets '
   +'WHERE id=$1',[initial.id]
  )).rows[0];
  assert.equal(Number(untouched.proposed_fee_minor),82550);
  assert.equal(untouched.proposal_revision,1);
 }finally{await db.end();}
});
