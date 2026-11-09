import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import pg from 'pg';
import {createOpportunity} from '../desktop/enkyron-crm-opportunities.mjs';
import {createProposalDraft,updateProposalDraft} from '../desktop/enkyron-crm-proposals.mjs';
import {recordSowDraft} from '../desktop/enkyron-crm-sow-drafts.mjs';
import {recordContractReference} from '../desktop/enkyron-crm-contract-references.mjs';
import {readSowSources} from '../desktop/enkyron-crm-sow-sources.mjs';
const url=process.env.ARL_CI_POSTGRES_URL||'';
function isolated(){
 assert.equal(process.env.CI,'true');
 const u=new URL(url);
 assert.equal(u.hostname,'127.0.0.1');
 assert.equal(u.pathname,'/arl_ci');assert.equal(u.username,'arl_ci');
 assert.equal(u.password,'synthetic-ci-only');
 return url;
}
test('E07-05B synthetic unverified contract reference is immutable and revision bound',{
 skip:!url&&'Disposable CI PostgreSQL only',timeout:60000
},async()=>{
 const db=new pg.Pool({connectionString:isolated(),max:3});
 const actor='ci-contr-'+randomUUID().slice(0,8);
 try{
  const uid='usr_contr_'+randomUUID(),lead='lead_contr_'+randomUUID();
  await db.query('INSERT INTO users(id,email,password_hash,created_at) VALUES($1,$2,$3,NOW())',
   [uid,'ci-contr-'+randomUUID()+'@example.invalid','synthetic']);
  await db.query('INSERT INTO sales_prospects (id,company_name,source,created_by,created_at,updated_at) '
   +'VALUES($1,$2,$3,$4,NOW(),NOW())',
   [lead,'Synthetic contract prospect','synthetic-ci',uid]);
  const opp=await createOpportunity(db,{prospect_id:lead,
   company_name_at_review:'Synthetic contract prospect',
   next_action:'Document synthetic engagement reference only',due_date:null},actor);
  const proposal=await createProposalDraft(db,{opportunity_id:opp.id,
   title:'Synthetic legal document reference',scope_text:'Documentary engagement review; no active testing authorised.',
   currency:'GBP',amount_minor:75000},actor);
  const sowInput={proposal_id:proposal.id,expected_revision:1,expected_sow_revision:0,confirmed:true,
   in_scope:'Documentation review of one synthetic AI agent workflow.',
   out_of_scope:'No active scanning, exploitation or production access.',
   deliverables:'Short architecture review, scoping summary, risk register.',
   acceptance_criteria:'Written summary identifies risks, evidence limits and exclusions.',
   target_inventory:'No actual target or technical testing permission is established.',
   dependencies:'Customer documents and separate written commercial agreement.',
   review_note:'Synthetic SOW created for contract reference acceptance tests.'};
  const sow=await recordSowDraft(db,sowInput,actor);assert.equal(sow.sow_revision,1);
  const receiptInput={proposal_id:proposal.id,expected_revision:1,
   expected_sow_revision:1,document_kind:'test_permission',
   source_reference:'external-claim-ci-'+randomUUID().slice(0,8),
   review_note:'Synthetic claimed reference only; no signed authorisation verified.',confirmed:true};
  const saved=await recordContractReference(db,receiptInput,actor);
  assert.equal(saved.evidence_status,'operator_reference_unverified');
  assert.equal(saved.testing_authorised,false);
  const preview=await readSowSources(db,proposal.id,actor);
  assert.equal(preview.contract_references.length,1);
  assert.equal(preview.contract_references[0].is_current_sow,true);
  assert.equal(preview.contract_references[0].evidence_status,'operator_reference_unverified');
  assert.equal(preview.testing_authorised,false);
  assert.equal(preview.contract_checks.find(x=>x.code==='right_to_test').status,'not_authorised');
  await assert.rejects(()=>recordContractReference(db,receiptInput,actor),/already logged/);
  await assert.rejects(()=>db.query(
   'UPDATE enkyron_crm_contract_references SET evidence_status=$1 WHERE id=$2',
   ['verified',saved.id]),/cannot be changed|immutable/i);
  await assert.rejects(()=>db.query(
   'DELETE FROM enkyron_crm_contract_references WHERE id=$1',[saved.id]),
   /cannot be changed|immutable/i);
  const rec=(await db.query(
   'SELECT proposal_revision,sow_revision,evidence_status FROM enkyron_crm_contract_references '
   +'WHERE workspace_key=$1 AND id=$2',['local:'+actor,saved.id])).rows[0];
  assert.equal(rec.sow_revision,1);assert.equal(rec.evidence_status,'operator_reference_unverified');
  await assert.rejects(()=>recordContractReference(db,receiptInput,'ci-other'),/not found/);
  await recordSowDraft(db,{...sowInput,expected_sow_revision:1,
   deliverables:sowInput.deliverables+' An additional written limitations note.'},actor);
  await assert.rejects(()=>recordContractReference(db,receiptInput,actor),/SOW version changed/);
  const stale=await readSowSources(db,proposal.id,actor);
  assert.equal(stale.contract_references[0].is_current_sow,false);
  assert.equal(stale.testing_authorised,false);
  const revised=await updateProposalDraft(db,{id:proposal.id,expected_revision:1,
   title:'Synthetic updated proposal',scope_text:'Documentary engagement review; no active testing authorised.',
   currency:'GBP',amount_minor:75000},actor);
  assert.equal(revised.revision,2);
  await assert.rejects(()=>recordContractReference(db,receiptInput,actor),/proposal revision changed/);
  const later=await readSowSources(db,proposal.id,actor);
  assert.equal(later.contract_references.length,0);
  const still=(await db.query(
   'SELECT count(*)::int AS n FROM enkyron_crm_contract_references WHERE workspace_key=$1 AND proposal_id=$2',
   ['local:'+actor,proposal.id])).rows[0].n;
  assert.equal(still,1);
 }finally{await db.end();}
});
