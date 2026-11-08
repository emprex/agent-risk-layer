import test from 'node:test';
import assert from 'node:assert/strict';
import {validateInvoiceDraft,readInvoicePreparation,recordInvoiceDraft,
  listInvoiceDrafts,readInvoiceDraft} from '../desktop/enkyron-crm-invoice-drafts.mjs';
const id='11111111-2222-4333-8444-555555555555';
const worksheetId='aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee';
const input={proposal_id:id,worksheet_id:worksheetId,expected_revision:2,
  preparation_note:'Synthetic invoice draft. Tax and legal issue status still unresolved.',
  confirmed:true};
test('requires explicit draft-only confirmation, no tax or invoice number',()=>{
 const v=validateInvoiceDraft(input);
 assert.equal(v.worksheet_id,worksheetId);
 assert.deepEqual(Object.keys(v).sort(),
  ['proposal_id','worksheet_id','expected_revision','preparation_note'].sort());
 for(const bad of [null,{},[],{...input,confirmed:false},
  {...input,worksheet_id:'wrong'},{...input,expected_revision:0},
  {...input,preparation_note:'short'},
  {...input,preparation_note:'ab'+String.fromCharCode(0)+'test'}]){
  assert.throws(()=>validateInvoiceDraft(bad),/CRM/);
 }
});
function mock({withWorksheet=true,stale=false,existing=false,
  malformed=false,otherWorkspace=false,missingStep=null,
  origin='research',decision='internal_draft_approved',expiredTerms=false}={}){
 const calls=[];let released=false;
 const proposal={id,revision:stale?3:2,title:'Synthetic draft service',
   currency:'GBP',amount_minor:'50000'};
 const worksheet={id:worksheetId,proposal_revision:2,
   source_approval_id:'approval',issuer_profile_id:'issuer',buyer_review_id:'buyer',
   terms_id:'terms',tax_review_id:'tax',proposal_title:proposal.title,
   currency:'GBP',proposed_fee_minor:'50000'};
 const issuer={id:'issuer',legal_name:'Synthetic Issuer Ltd',
   registration_number:'00000000',registered_office:'10 Example Road, London'};
 const buyer={id:'buyer',legal_name:'Synthetic Buyer Ltd',
   registered_address:'20 Fictional Avenue, London'};
 const q=async(sql,params)=>{
  calls.push({sql,params});
  if(sql.startsWith('SELECT id,title,revision'))return {rows:otherWorkspace?[]:[proposal]};
  if(sql.startsWith('SELECT o.prospect_id,o.company_id,o.source_ticket_id'))
    return {rows:[origin==='company'
      ?{prospect_id:null,company_id:id,source_ticket_id:worksheetId}
      :{prospect_id:'ARL-P-000001',company_id:null,source_ticket_id:null}]};
  if(sql.startsWith('SELECT\n  EXISTS'))return {rows:[{
    issuer_profile:missingStep!=='issuer',company_link:missingStep!=='link',
    buyer_review:missingStep!=='buyer',terms_recorded:missingStep!=='terms',
    terms_valid:missingStep!=='terms'&&!expiredTerms,tax_review:missingStep!=='tax',
    internal_decision:missingStep==='internal'?'needs_changes':decision
  }]};
  if(sql.startsWith('SELECT id,proposal_revision,source_approval_id'))return {rows:withWorksheet?[worksheet]:[]};
  if(sql.startsWith('SELECT id,legal_name,registration_number'))return {rows:[issuer]};
  if(sql.startsWith('SELECT id,legal_name,registered_address'))return {rows:malformed?[]:[buyer]};
  if(sql.startsWith('SELECT id FROM enkyron_crm_invoice_drafts'))
    return {rows:existing?[{id:'old'}]:[]};
  if(sql.startsWith('SELECT id,proposal_id,proposal_revision'))return {rows:[]};
  return {rows:[]};
 };
 return {pool:{connect:async()=>({query:q,release(){released=true;}}),query:q},
  calls,get released(){return released;}};
}
test('read preparation is consistent, scoped and blocks unapproved worksheets',async()=>{
 const a=mock({withWorksheet:false});
 const r=await readInvoicePreparation(a.pool,id,'local-operator');
 assert.equal(r.can_prepare,false);
 assert.equal(r.worksheet_id,null);
 assert.equal(r.prospect_id,'ARL-P-000001');
 assert.equal(r.company_id,null);
 assert.equal(r.source_ticket_id,null);
 assert.match(r.blockers.join(' '),/worksheet/);
 assert.deepEqual(r.steps.map(s=>s.key),
   ['issuer','link','buyer','terms','tax','internal','worksheet']);
 assert.equal(r.steps.find(s=>s.key==='worksheet').ready,false);
 assert.deepEqual(a.calls[1].params,['local:local-operator',id]);
 assert.deepEqual(a.calls[2].params,['local:local-operator',id]);
 assert.equal(a.calls[0].sql,'BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
 assert.equal(a.calls.at(-1).sql,'COMMIT');
 const b=mock();
 const ready=await readInvoicePreparation(b.pool,id,'local-operator');
 assert.equal(ready.can_prepare,true);
 assert.equal(ready.vat_treatment,'undetermined');
 assert.equal(ready.issuer.legal_name,'Synthetic Issuer Ltd');
 assert.equal(ready.buyer.legal_name,'Synthetic Buyer Ltd');
 assert.equal(ready.current_draft_id,null);
 assert.equal(ready.steps.length,7);
 assert.ok(ready.steps.every(step=>step.ready));
 assert.equal(ready.steps.find(step=>step.key==='link').action,'research');
 assert.ok(ready.steps.every(step=>!('company_utr' in step)));
 const c=mock({existing:true});
 assert.equal((await readInvoicePreparation(c.pool,id,'local-operator')).can_prepare,false);
 const d=mock({otherWorkspace:true});
 await assert.rejects(()=>readInvoicePreparation(d.pool,id,'local-operator'),/not found/);
 for(const key of ['issuer','link','buyer','terms','tax','internal']){
   const blocked=mock({missingStep:key});
   const status=await readInvoicePreparation(blocked.pool,id,'local-operator');
   assert.equal(status.can_prepare,false);
   assert.equal(status.steps.find(step=>step.key===key).ready,false);
   assert.ok(status.blockers.length>0);
   await assert.rejects(()=>recordInvoiceDraft(
     blocked.pool,input,'local-operator'),/incomplete current-revision prerequisites/);
 }
 const changes=await readInvoicePreparation(
   mock({missingStep:'internal'}).pool,id,'local-operator');
 assert.match(changes.steps.find(x=>x.key==='internal').detail,/revise the proposal/);
 const expired=mock({expiredTerms:true});
 const status=await readInvoicePreparation(expired.pool,id,'local-operator');
 assert.equal(status.can_prepare,false);
 assert.equal(status.steps.find(x=>x.key==='terms').action,'proposal');
 assert.match(status.steps.find(x=>x.key==='terms').detail,/expired/);
 await assert.rejects(()=>recordInvoiceDraft(
   expired.pool,input,'local-operator'),/incomplete current-revision prerequisites/);
});
test('write is transactional and refuses staleness, missing buyer and duplicate',async()=>{
 const a=mock();
 const r=await recordInvoiceDraft(a.pool,input,'local-operator',{uuid:()=>id});
 assert.equal(r.status,'unissued_tax_review_required');
 const insert=a.calls.find(x=>x.sql.startsWith('INSERT'));
 assert.equal(insert.params[1],'local:local-operator');
 assert.equal(insert.params[17],50000);
 assert.equal(insert.params[10],'Synthetic Issuer Ltd');
 assert.equal(insert.params[13],'Synthetic Buyer Ltd');
 assert.equal(a.calls.at(-1).sql,'COMMIT');
 assert.equal(a.calls.some(x=>/^\s*(UPDATE|DELETE)\b/.test(x.sql)),false);
 assert.equal(a.released,true);
 for(const option of [{stale:true},{withWorksheet:false},
   {existing:true},{malformed:true},{otherWorkspace:true}]){
  const b=mock(option);
  await assert.rejects(()=>recordInvoiceDraft(b.pool,input,'local-operator'),/CRM/);
  assert.equal(b.calls.at(-1).sql,'ROLLBACK');
  assert.equal(b.calls.some(x=>x.sql.startsWith('INSERT')),false);
 }
});
test('invoice draft list and read do not introduce computed VAT',async()=>{
 const pool={query:async(sql,params)=>{
  if(sql.startsWith('SELECT id,proposal_id,proposal_revision,service_description'))
    return {rows:[]};
  return {rows:[{id,status:'unissued_tax_review_required',vat_amount_minor:null,
    invoice_number:null,invoice_total_minor:null}]};
 }};
 const listed=await listInvoiceDrafts(pool,'','local-operator');
 assert.equal(listed.items.length,0);
 const d=await readInvoiceDraft(pool,id,'local-operator');
 assert.equal(d.draft.invoice_total_minor,null);
 assert.equal(d.draft.invoice_number,null);
});

test('company-origin invoice preflight accepts only the reviewed company-ticket path',async()=>{
  const complete=mock({origin:'company'});
  const result=await readInvoicePreparation(complete.pool,id,'local-operator');
  assert.equal(result.can_prepare,true);
  assert.equal(result.prospect_id,null);
  assert.equal(result.company_id,id);
  assert.equal(result.source_ticket_id,worksheetId);
  assert.equal(result.origin_kind,'reviewed_company_ticket');
  assert.equal(result.steps.find(x=>x.key==='link').action,'company');
  assert.equal(result.steps.find(x=>x.key==='link').ready,true);
  const checks=complete.calls.find(x=>x.sql.startsWith('SELECT\n  EXISTS'));
  assert.match(checks.sql,/enkyron_crm_effective_ticket_links/);
  assert.match(checks.sql,/e.workspace_key=d.workspace_key/);
  assert.match(checks.sql,/e.ticket_id=o.source_ticket_id/);
  assert.match(checks.sql,/enkyron_crm_prospect_links/);
  const recorded=mock({origin:'company'});
  const saved=await recordInvoiceDraft(recorded.pool,input,'local-operator',{uuid:()=>id});
  assert.equal(saved.status,'unissued_tax_review_required');
  const revoked=mock({origin:'company',missingStep:'link'});
  const blocked=await readInvoicePreparation(revoked.pool,id,'local-operator');
  assert.equal(blocked.can_prepare,false);
  assert.equal(blocked.steps.find(x=>x.key==='link').action,'company');
  assert.match(blocked.steps.find(x=>x.key==='link').detail,/still be effective/);
  assert.match(blocked.blockers.join(' '),/Reviewed company-ticket association/);
  await assert.rejects(()=>recordInvoiceDraft(
    revoked.pool,input,'local-operator'
  ),/incomplete current-revision prerequisites/);
  assert.ok(!revoked.calls.some(x=>x.sql.startsWith('INSERT')));
});
