import test from 'node:test';
import assert from 'node:assert/strict';
import {validateInvoiceIssueReview,readInvoiceIssueReview,
  recordInvoiceIssueReview} from '../desktop/enkyron-crm-invoice-issue-review.mjs';

const id='11111111-2222-4333-8444-555555555555';
const base={invoice_draft_id:id,outcome:'needs_changes',confirmed:true,
 review_note:'Additional source and tax position verification remain outstanding.'};
const complete={...base,outcome:'documents_logged',supply_date:'2026-11-06',
 customer_authorisation_reference:'Client order fixture',
 tax_evidence_reference:'Human VAT research source',
 payment_terms_reference:'Contract payment clause fixture'};
test('human review validates source completeness, never accepts declared approval',()=>{
 assert.equal(validateInvoiceIssueReview(base).supply_date,null);
 assert.equal(validateInvoiceIssueReview(complete).outcome,'documents_logged');
 for(const bad of [null,{},[],{...base,confirmed:false},
 {...base,invoice_draft_id:'invalid'},{...base,outcome:'approved'},
 {...base,review_note:'short'},{...base,review_note:'unsafe'+String.fromCharCode(0)},
 {...complete,supply_date:'2026-02-30'},
 {...complete,supply_date:'11/06/2026'},
 {...complete,tax_evidence_reference:null},
 {...complete,payment_terms_reference:'a'}]){
  assert.throws(()=>validateInvoiceIssueReview(bad),/CRM/);
 }
 assert.equal(Object.hasOwn(validateInvoiceIssueReview(complete),'vat_rate'),false);
 assert.equal(Object.hasOwn(validateInvoiceIssueReview(complete),'invoice_number'),false);
});
function fake({exists=true,vatStatus='unknown',hasEmail=false,hasReviews=false}={}){
 const calls=[];let released=false;
 const draft={id,issuer_profile_id:'issuer',status:'unissued_tax_review_required',
   vat_treatment:'undetermined',invoice_number:null,issued_at:null};
 const query=async(sql,params)=>{
  calls.push({sql,params});
  if(sql.startsWith('SELECT id,proposal_id,proposal_revision,source_worksheet_id'))return {rows:exists?[draft]:[]};
  if(sql.startsWith('SELECT id,vat_status,vat_number,company_email'))
    return {rows:[{vat_status:vatStatus,vat_number:null,
      company_email:hasEmail?'billing@example.invalid':null}]};
  if(sql.startsWith('SELECT id,outcome,supply_date::text'))return {rows:hasReviews?
    [{id,outcome:'needs_changes',recorded_at:'2026-11-06'}]:[]};
  return {rows:[]};
 };
 return {pool:{connect:async()=>({query,release:()=>{released=true;}})},
  calls,get released(){return released;}};
}
test('pre-issue lookup remains read-only, includes genuine blockers, no authority',async()=>{
 const x=fake();
 const a=await readInvoiceIssueReview(x.pool,id,'operator');
 assert.equal(a.issue_authorised,false);
 assert.equal(a.invoice_gate,'blocked_no_verified_issue_authority');
 assert.match(a.documentary_gaps.join(' '),/No human documentary review/);
 assert.match(a.documentary_gaps.join(' '),/supply date/);
 assert.match(a.documentary_gaps.join(' '),/customer authorisation/);
 assert.match(a.documentary_gaps.join(' '),/tax evidence/);
 assert.match(a.documentary_gaps.join(' '),/payment terms/);
 assert.match(a.blockers.join(' '),/VAT status/);
 assert.match(a.blockers.join(' '),/email/);
 assert.deepEqual(x.calls[1].params,['local:operator',id]);
 assert.equal(x.calls[0].sql,'BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
 assert.equal(x.calls.at(-1).sql,'COMMIT');
 assert.equal(x.released,true);
});
test('manual review can append even when tax unresolved, never issues invoice',async()=>{
 const x=fake();
 const out=await recordInvoiceIssueReview(x.pool,base,'operator',{uuid:()=>id});
 assert.equal(out.issue_authorised,false);
 assert.equal(out.outcome,'needs_changes');
 const insert=x.calls.find(q=>q.sql.startsWith('INSERT'));
 assert.deepEqual(insert.params.slice(0,4),[id,'local:operator',id,'needs_changes']);
 assert.equal(x.calls.at(-1).sql,'COMMIT');
 assert.ok(x.calls.every(q=>!/^\s*(UPDATE|DELETE)\b/.test(q.sql)));
 const missing=fake({exists:false});
 await assert.rejects(()=>recordInvoiceIssueReview(missing.pool,base,'operator'),/not found/);
 assert.equal(missing.calls.at(-1).sql,'ROLLBACK');
});

test('documented sources and synthetic review never make issuance authorised',async()=>{
 const x=fake({hasReviews:true,vatStatus:'registered',hasEmail:true});
 const snapshot=await readInvoiceIssueReview(x.pool,id,'operator');
 assert.equal(snapshot.latest.outcome,'needs_changes');
 assert.match(snapshot.documentary_gaps.join(' '),/requires changes/);
 assert.equal(snapshot.invoice_gate,'blocked_no_verified_issue_authority');
 assert.equal(snapshot.issue_authorised,false);
 assert.equal(x.calls[0].sql,'BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
 assert.equal(x.calls.at(-1).sql,'COMMIT');
});
