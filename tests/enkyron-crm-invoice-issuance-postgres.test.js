import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID,createHash} from 'node:crypto';
import pg from 'pg';
import {createOpportunity} from '../desktop/enkyron-crm-opportunities.mjs';
import {createProposalDraft} from '../desktop/enkyron-crm-proposals.mjs';
import {createCompany} from '../desktop/enkyron-crm.mjs';
import {recordCompanyProfile} from '../desktop/enkyron-company-profile.mjs';
import {recordBuyerReview} from '../desktop/enkyron-crm-buyer-review.mjs';
import {recordCommercialTerms} from '../desktop/enkyron-crm-commercial-terms.mjs';
import {recordTaxReview} from '../desktop/enkyron-crm-tax-review.mjs';
import {recordInternalDecision} from '../desktop/enkyron-crm-internal-review.mjs';
import {recordBillingWorksheet} from '../desktop/enkyron-crm-billing-worksheet.mjs';
import {recordInvoiceDraft} from '../desktop/enkyron-crm-invoice-drafts.mjs';
import {readInvoiceIssuePreflight,issueInvoice,listIssuedInvoices,
 readIssuedInvoice,recordInvoicePayment} from '../desktop/enkyron-crm-invoice-issuance.mjs';

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
function profile(revision,vatStatus,source){
 return {
   expected_revision:revision,confirmed:true,
   legal_name:'CI Example Issuer Ltd',registration_number:'12345678',
   registered_office:'12 Example Road, London EC1A 1AA, UK',
   incorporation_country:'GB',company_email:'billing@example.invalid',
   vat_status:vatStatus,default_currency:'GBP',
   source_reference:source,
   verification_notes:'CI-only example profile; no external customer or actual registration.'
 };
}
test('E09 real PostgreSQL numbered invoice and payment workflow (disposable CI DB only)',{
 skip:!uri&&'Dedicated CI PostgreSQL only',timeout:90000
},async()=>{
 const db=new pg.Pool({connectionString:isolated(),max:3});
 const actor='ci-bill-'+randomUUID().slice(0,8);
 const key='local:'+actor,other=actor+'-foreign';
 try{
   const uid='usr_bill_'+randomUUID(),lead='lead_bill_'+randomUUID();
   await db.query(
     'INSERT INTO users(id,email,password_hash,created_at) VALUES($1,$2,$3,NOW())',
     [uid,'ci-bill-'+randomUUID()+'@example.invalid','ci-only']);
   await db.query(
     'INSERT INTO sales_prospects '
     +'(id,company_name,source,created_by,created_at,updated_at) '
     +'VALUES($1,$2,$3,$4,NOW(),NOW())',
     [lead,'CI Example Sales Prospect','synthetic-ci',uid]);
   const opportunity=await createOpportunity(db,{
     prospect_id:lead,company_name_at_review:'CI Example Sales Prospect',
     next_action:'CI source fixture for invoicing',due_date:null
   },actor);
   const proposal=await createProposalDraft(db,{
     opportunity_id:opportunity.id,title:'CI example commercial service package',
     scope_text:'Offline CI example; there is no actual customer or delivered service.',
     currency:'GBP',amount_minor:75000
   },actor);
   await recordCompanyProfile(db,profile(0,'unknown','CI initial issuer source'),actor);
   const company=await createCompany(db,{
     name:'CI Example Buyer Ltd',legal_name:'CI Example Buyer Ltd',
     city:'London',country:'GB',sector:'CI example'
   },actor);
   await db.query(
     'INSERT INTO enkyron_crm_prospect_links '
     +'(id,workspace_key,prospect_id,company_id,source_digest,review_note,linked_by) '
     +'VALUES($1,$2,$3,$4,$5,$6,$7)',
     [randomUUID(),key,lead,company.id,
      createHash('sha256').update('ci-billing-'+randomUUID()).digest('hex'),
      'Explicit CI-only fixture association, never an actual customer.',actor]);
   await recordBuyerReview(db,{
     proposal_id:proposal.id,company_id:company.id,expected_revision:1,
     legal_name:'CI Example Buyer Ltd',
     registered_address:'7 Example Square, London SW1A 1AA, United Kingdom',
     source_reference:'CI only buyer fixture',
     review_note:'Fictional CI buyer; no real customer is involved in this isolated test.',
     confirmed:true
   },actor);
   await recordCommercialTerms(db,{
     proposal_id:proposal.id,expected_revision:1,confirmed:true,
     valid_until:'2099-12-31',
     payment_terms:'Example payment thirty days after invoice date.',
     delivery_terms:'No real work, delivery or access is occurring.',
     exclusions:'No active security assessment or service provision.',
     assumptions:'Only disposable CI fixtures; no legal or fiscal authority.',
     source_reference:'CI contract placeholder'
   },actor);
   await recordTaxReview(db,{
     proposal_id:proposal.id,expected_revision:1,confirmed:true,
     buyer_type:'unknown',buyer_country:'',service_mode:'human_led_advisory',
     business_evidence:'',location_evidence:'',
     uk_vat_registration:'unknown',overseas_withholding:'not_checked',
     review_notes:'CI-only tax research; not an actual tax determination.',
     source_reference:'CI tax sample'
   },actor);
   const approval=await recordInternalDecision(db,{
     proposal_id:proposal.id,expected_revision:1,confirmed:true,
     decision:'internal_draft_approved',
     review_note:'Operator-only CI document approval is not a real commercial agreement.'
   },actor);
   const worksheet=await recordBillingWorksheet(db,{
     proposal_id:proposal.id,expected_revision:1,
     approval_id:approval.id,confirmed:true,
     preparation_note:'CI-only internal worksheet, no real receivable recorded.'
   },actor);
   const draft=await recordInvoiceDraft(db,{
     proposal_id:proposal.id,worksheet_id:worksheet.id,expected_revision:1,
     preparation_note:'CI-only source draft, no real invoice or customer agreement.',
     confirmed:true
   },actor);
   const initial=await readInvoiceIssuePreflight(db,draft.id,actor);
   assert.equal(initial.available,true);
   assert.match(initial.issues.join(' '),/VAT status/);
   await assert.rejects(()=>issueInvoice(db,{
     draft_id:draft.id,supply_date:'2026-11-01',due_days:30,
     vat_rate_percent:0,issuance_basis:'CI-only source fixture',confirmed:true
   },actor),/VAT status/);
   // Update issuer status WITHOUT rebuilding the quote, SOW, worksheet or invoice draft.
   await recordCompanyProfile(db,profile(1,'not_registered','CI operator VAT position'),actor);
   const checked=await readInvoiceIssuePreflight(db,draft.id,actor);
   assert.equal(checked.available,true);
   assert.deepEqual(checked.issues,[]);
   const today=(await db.query('SELECT CURRENT_DATE::text AS day')).rows[0].day;
   const payload={
     draft_id:draft.id,supply_date:today,due_days:30,vat_rate_percent:0,
     customer_reference:'CI-PO-001',issuance_basis:'CI-only customer and delivery fixture',
     confirmed:true
   };
   await assert.rejects(()=>issueInvoice(db,{
     ...payload,vat_rate_percent:20
   },actor),/cannot charge VAT/);
   const result=await issueInvoice(db,payload,actor);
   assert.match(result.invoice_number,/^INV-\d{4}-\d{6}$/);
   assert.equal(result.total_minor,75000);
   assert.equal(result.vat_amount_minor,0);
   await assert.rejects(()=>issueInvoice(db,payload,actor),/already issued/);
   const existing=await readInvoiceIssuePreflight(db,draft.id,actor);
   assert.equal(existing.existing_invoice.id,result.id);
   assert.equal(existing.issues.length,1);
   assert.deepEqual((await listIssuedInvoices(db,'',other)).items,[]);
   await assert.rejects(()=>readIssuedInvoice(db,result.id,other),/not found/);
   const page=await listIssuedInvoices(db,'CI Example',actor);
   assert.ok(page.items.some(row=>row.id===result.id));
   const invoice=(await readIssuedInvoice(db,result.id,actor)).invoice;
   assert.equal(invoice.subtotal_minor,'75000');
   assert.equal(invoice.total_minor,'75000');
   assert.equal(invoice.balance_minor,75000);
   assert.equal(invoice.payment_status,'unpaid');
   assert.equal(invoice.line_items.length,1);
   await assert.rejects(db.query(
     'UPDATE enkyron_crm_issued_invoices SET total_minor=10 WHERE id=$1',
     [result.id]),/cannot be changed or deleted|immutable/);
   await assert.rejects(()=>recordInvoicePayment(db,{
     invoice_id:result.id,amount_minor:75001,
     paid_on:today,payment_reference:'CI-REF-OVERPAY',confirmed:true
   },actor),/exceeds/);
   const part=await recordInvoicePayment(db,{
     invoice_id:result.id,amount_minor:25000,
     paid_on:today,payment_reference:'CI-BANK-ONE',confirmed:true
   },actor);
   assert.equal(part.balance_minor,50000);
   await assert.rejects(()=>recordInvoicePayment(db,{
     invoice_id:result.id,amount_minor:25000,
     paid_on:today,payment_reference:'CI-BANK-ONE',confirmed:true
   },actor),/already recorded/);
   const finish=await recordInvoicePayment(db,{
     invoice_id:result.id,amount_minor:50000,
     paid_on:today,payment_reference:'CI-BANK-TWO',confirmed:true
   },actor);
   assert.equal(finish.balance_minor,0);
   assert.equal((await readIssuedInvoice(db,result.id,actor)).invoice.payment_status,'paid');
   await assert.rejects(db.query(
     'DELETE FROM enkyron_crm_invoice_payments WHERE invoice_id=$1',
     [result.id]),/cannot be changed or deleted|immutable/);
   const frozen=(await db.query(
     'SELECT status,invoice_number FROM enkyron_crm_invoice_drafts '
     +'WHERE workspace_key=$1 AND id=$2',[key,draft.id]
   )).rows[0];
   assert.equal(frozen.status,'unissued_tax_review_required');
   assert.equal(frozen.invoice_number,null);
 }finally{await db.end();}
});
