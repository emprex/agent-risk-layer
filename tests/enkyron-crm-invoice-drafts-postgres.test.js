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
import {recordBillingWorksheet} from '../desktop/enkyron-crm-billing-worksheet.mjs';
import {readInvoiceIssueReview,recordInvoiceIssueReview}
  from '../desktop/enkyron-crm-invoice-issue-review.mjs';
import {listInvoiceDrafts,readInvoiceDraft,readInvoicePreparation,recordInvoiceDraft}
  from '../desktop/enkyron-crm-invoice-drafts.mjs';

const uri=process.env.ARL_CI_POSTGRES_URL||'';
function isolated(){
  assert.equal(process.env.CI,'true');
  const u=new URL(uri);
  assert.equal(u.hostname,'127.0.0.1');
  assert.equal(u.pathname,'/arl_ci');
  assert.equal(u.username,'arl_ci');
  assert.equal(u.password,'synthetic-ci-only');
  return uri;
}
test('real PostgreSQL invoice drafts: source gate, immutable snapshots and no invoice issue',{
  skip:!uri&&'Isolated CI PostgreSQL only',timeout:60000
},async()=>{
  const db=new pg.Pool({connectionString:isolated(),max:3});
  const actor='ci-invoice-'+randomUUID().slice(0,8);
  const foreign=actor+'-foreign';
  const count=async(table)=>(await db.query(
    'SELECT count(*)::int AS n FROM '+table
  )).rows[0].n;
  try{
    const before={
      tickets:await count('arl_workbench_tickets'),
      messages:await count('sales_messages')
    };
    const user='usr_invoice_'+randomUUID();
    const lead='lead_invoice_'+randomUUID();
    await db.query(
      'INSERT INTO users(id,email,password_hash,created_at) VALUES($1,$2,$3,NOW())',
      [user,'ci-invoice-'+randomUUID()+'@example.invalid','synthetic']);
    await db.query(
      'INSERT INTO sales_prospects '
      +'(id,company_name,source,created_by,created_at,updated_at) '
      +'VALUES($1,$2,$3,$4,NOW(),NOW())',
      [lead,'Synthetic prospect (not buyer)','synthetic-ci',user]);
    const opp=await createOpportunity(db,{
      prospect_id:lead,company_name_at_review:'Synthetic prospect (not buyer)',
      next_action:'Manual invoice draft preparation only',due_date:'2026-12-12'
    },actor);
    const proposal=await createProposalDraft(db,{
      opportunity_id:opp.id,title:'Synthetic invoice draft source service',
      scope_text:'Service proposed, no signed contract or assessment authorisation.',
      currency:'GBP',amount_minor:68525
    },actor);
    const first=await readInvoicePreparation(db,proposal.id,actor);
    assert.equal(first.can_prepare,false);
    assert.equal(first.worksheet_id,null);
    assert.equal(first.prospect_id,lead);
    assert.equal(first.proposed_fee_minor,68525);
    assert.equal(first.steps.length,7);
    assert.equal(first.steps.find(x=>x.key==='link').ready,false);
    assert.equal(first.steps.find(x=>x.key==='buyer').ready,false);
    assert.equal(first.steps.find(x=>x.key==='worksheet').ready,false);
    await assert.rejects(
      ()=>readInvoicePreparation(db,proposal.id,foreign),/not found/);

    const issuer=await recordCompanyProfile(db,{
      expected_revision:0,confirmed:true,
      legal_name:'Synthetic Invoicing Company Ltd',
      trading_name:'Synthetic Company',registration_number:'00000000',
      company_utr:'0123456789',tax_office_number:'001',
      incorporation_country:'GB',
      registered_office:'10 Fictional Road, London EX1 1AB',
      company_email:'accounts@example.invalid',
      vat_status:'unknown',default_currency:'GBP',
      source_reference:'Synthetic issuer registry',
      verification_notes:'Synthetic issuer data only, not verified against HMRC.'
    },actor);
    assert.equal(issuer.revision,1);
    const company=await createCompany(db,{
      name:'Synthetic Customer',
      legal_name:'Synthetic Customer Ltd',city:'London',country:'GB',
      website:'https://example.invalid',sector:'Test business'
    },actor);
    await db.query(
      'INSERT INTO enkyron_crm_prospect_links '
      +'(id,workspace_key,prospect_id,company_id,source_digest,review_note,linked_by) '
      +'VALUES($1,$2,$3,$4,$5,$6,$7)',
      [randomUUID(),'local:'+actor,lead,company.id,
        createHash('sha256').update('synthetic-invoice-link').digest('hex'),
        'Manually linked synthetic business with synthetic research prospect.',
        actor]
    );
    await recordBuyerReview(db,{
      proposal_id:proposal.id,company_id:company.id,
      expected_revision:1,confirmed:true,
      legal_name:'Synthetic Customer Ltd',
      registered_address:'20 Imaginary Road, London EX1 3ZZ',
      source_reference:'Synthetic buyer fixture',
      review_note:'Operator-entered buyer information is synthetic and unverified.'
    },actor);
    await recordCommercialTerms(db,{
      proposal_id:proposal.id,expected_revision:1,confirmed:true,
      valid_until:'2099-12-31',
      payment_terms:'No payment obligation exists until a later signed agreement.',
      delivery_terms:'Work would begin after a separately authorised schedule.',
      exclusions:'No assessment, live testing or remediation currently authorised.',
      assumptions:'Tax and legal terms are still subject to a separate human decision.',
      source_reference:'Synthetic commercial agreement draft'
    },actor);
    await recordTaxReview(db,{
      proposal_id:proposal.id,expected_revision:1,confirmed:true,
      buyer_type:'unknown',buyer_country:'',service_mode:'human_led_advisory',
      business_evidence:'',location_evidence:'',
      uk_vat_registration:'unknown',overseas_withholding:'not_checked',
      review_notes:'No VAT determination; customer geography and tax position unknown.',
      source_reference:'Synthetic tax research only'
    },actor);
    const approval=await recordInternalDecision(db,{
      proposal_id:proposal.id,expected_revision:1,confirmed:true,
      decision:'internal_draft_approved',
      review_note:'Only the internal draft content is approved, not invoicing or tax.'
    },actor);
    const worksheet=await recordBillingWorksheet(db,{
      proposal_id:proposal.id,expected_revision:1,
      approval_id:approval.id,confirmed:true,
      preparation_note:'Synthetic prebilling worksheet; this creates no invoice.'
    },actor);
    const ready=await readInvoicePreparation(db,proposal.id,actor);
    assert.equal(ready.can_prepare,true);
    assert.equal(ready.worksheet_id,worksheet.id);
    assert.equal(ready.issuer.legal_name,'Synthetic Invoicing Company Ltd');
    assert.equal(ready.buyer.legal_name,'Synthetic Customer Ltd');
    assert.equal(ready.vat_treatment,'undetermined');
    assert.equal(ready.steps.length,7);
    assert.ok(ready.steps.every(x=>x.ready));
    assert.deepEqual(ready.steps.map(x=>x.action),
      ['issuer','research','buyer','terms','tax','internal','worksheet']);
    assert.doesNotMatch(JSON.stringify(ready),/0123456789|company_utr|tax_office_number/);
    const note='Internal invoice drafting only; VAT, invoice issue and amount due pending.';
    const request={proposal_id:proposal.id,worksheet_id:worksheet.id,
      expected_revision:1,preparation_note:note,confirmed:true};
    await assert.rejects(()=>recordInvoiceDraft(db,{
      ...request,worksheet_id:randomUUID()
    },actor),/requires current approved billing worksheet/);
    const created=await recordInvoiceDraft(db,request,actor);
    assert.equal(created.status,'unissued_tax_review_required');
    const draft=(await readInvoiceDraft(db,created.id,actor)).draft;
    assert.equal(draft.issuer_legal_name,'Synthetic Invoicing Company Ltd');
    assert.equal(draft.buyer_legal_name,'Synthetic Customer Ltd');
    assert.equal(draft.issuer_registration_number,'00000000');
    assert.equal(draft.proposed_fee_minor,'68525');
    assert.equal(draft.currency,'GBP');
    assert.equal(draft.vat_treatment,'undetermined');
    assert.equal(draft.invoice_total_minor,null);
    assert.equal(draft.vat_amount_minor,null);
    assert.equal(draft.invoice_number,null);
    assert.equal(draft.issued_at,null);
    assert.doesNotMatch(JSON.stringify(draft),/0123456789|company_utr|tax_office_number/);
    const list=await listInvoiceDrafts(db,'Synthetic Customer',actor);
    assert.ok(list.items.some(x=>x.id===created.id));
    assert.deepEqual((await listInvoiceDrafts(db,'',foreign)).items,[]);
    await assert.rejects(()=>readInvoiceDraft(db,created.id,foreign),/not found/);
    await assert.rejects(()=>recordInvoiceDraft(db,request,actor),/already recorded/);
    await assert.rejects(()=>db.query(
      'UPDATE enkyron_crm_invoice_drafts SET status=$1 WHERE id=$2',
      ['issued',created.id]),/cannot be changed or deleted/);
    await assert.rejects(()=>db.query(
      'DELETE FROM enkyron_crm_invoice_drafts WHERE id=$1',[created.id]
    ),/cannot be changed or deleted/);

    // Issue documentary checks NEVER issue an invoice, even with all sources logged.
    const initialReview=await readInvoiceIssueReview(db,created.id,actor);
    assert.equal(initialReview.issue_authorised,false);
    assert.equal(initialReview.issuer_vat_status,'unknown');
    assert.match(initialReview.blockers.join(' '),/VAT status/);
    assert.equal(initialReview.history.length,0);
    assert.doesNotMatch(JSON.stringify(initialReview),/0123456789|company_utr|tax_office_number/);
    await assert.rejects(()=>readInvoiceIssueReview(db,created.id,foreign),/not found/);
    const reviewBase={
      invoice_draft_id:created.id,outcome:'needs_changes',confirmed:true,
      review_note:'No verified VAT position or customer order exists in synthetic test data.'
    };
    const needs=await recordInvoiceIssueReview(db,reviewBase,actor);
    assert.equal(needs.issue_authorised,false);
    const documented=await recordInvoiceIssueReview(db,{
      ...reviewBase,outcome:'documents_logged',supply_date:'2026-11-06',
      customer_authorisation_reference:'Synthetic customer order only',
      tax_evidence_reference:'Synthetic independent accountant research',
      payment_terms_reference:'Synthetic accepted terms only',
      review_note:'All references are synthetic and remain unverified by the software.'
    },actor);
    assert.equal(documented.issue_authorised,false);
    const reviewed=await readInvoiceIssueReview(db,created.id,actor);
    assert.equal(reviewed.issue_authorised,false);
    assert.equal(reviewed.history.length,2);
    assert.equal(reviewed.latest.outcome,'documents_logged');
    assert.deepEqual(reviewed.history.map(x=>x.outcome),
      ['documents_logged','needs_changes']);
    assert.deepEqual((await db.query(
      'SELECT count(*)::int AS n FROM enkyron_crm_invoice_issue_reviews '
      +'WHERE workspace_key=$1 AND invoice_draft_id=$2',
      ['local:'+foreign,created.id]
    )).rows[0].n,0);
    await assert.rejects(()=>recordInvoiceIssueReview(db,reviewBase,foreign),/not found/);
    await assert.rejects(()=>db.query(
      'UPDATE enkyron_crm_invoice_issue_reviews SET review_note=$1 WHERE id=$2',
      ['Tampered',needs.id]),/cannot be changed or deleted/);
    await assert.rejects(()=>db.query(
      'DELETE FROM enkyron_crm_invoice_issue_reviews WHERE id=$1',
      [needs.id]),/cannot be changed or deleted/);
    const stillUnissued=(await readInvoiceDraft(db,created.id,actor)).draft;
    assert.equal(stillUnissued.invoice_number,null);
    assert.equal(stillUnissued.vat_amount_minor,null);
    assert.equal(stillUnissued.invoice_total_minor,null);
    assert.equal(stillUnissued.status,'unissued_tax_review_required');

    const revised=await updateProposalDraft(db,{
      id:proposal.id,expected_revision:1,
      title:'Revised invoice draft source service',
      scope_text:'Still an internal draft; no customer authorisation or delivery.',
      currency:'GBP',amount_minor:90000
    },actor);
    assert.equal(revised.revision,2);
    const blocked=await readInvoicePreparation(db,proposal.id,actor);
    assert.equal(blocked.can_prepare,false);
    assert.equal(blocked.worksheet_id,null);
    assert.equal(blocked.steps.find(x=>x.key==='buyer').ready,false);
    assert.equal(blocked.steps.find(x=>x.key==='internal').ready,false);
    await assert.rejects(()=>recordInvoiceDraft(db,request,actor),/proposal changed/);
    const frozen=(await readInvoiceDraft(db,created.id,actor)).draft;
    assert.equal(frozen.proposed_fee_minor,'68525');
    assert.equal(frozen.proposal_revision,1);
    assert.equal(await count('arl_workbench_tickets'),before.tickets);
    assert.equal(await count('sales_messages'),before.messages);
  }finally{await db.end();}
});
