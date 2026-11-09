import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import pg from 'pg';
import {createOpportunity} from '../desktop/enkyron-crm-opportunities.mjs';
import {createProposalDraft,updateProposalDraft} from '../desktop/enkyron-crm-proposals.mjs';
import {readSowDraft,recordSowDraft} from '../desktop/enkyron-crm-sow-drafts.mjs';
import {readSowSources} from '../desktop/enkyron-crm-sow-sources.mjs';
const url=process.env.ARL_CI_POSTGRES_URL||'';
function onlyCi(){
 assert.equal(process.env.CI,'true');
 const u=new URL(url);
 assert.equal(u.hostname,'127.0.0.1');
 assert.equal(u.pathname,'/arl_ci');
 assert.equal(u.username,'arl_ci');
 assert.equal(u.password,'synthetic-ci-only');
 return url;
}
test('E07-04B1 SOW: optimistic immutable revisions and proposal reversion',{
 skip:!url&&'Isolated CI PostgreSQL only',timeout:60_000
},async()=>{
 const db=new pg.Pool({connectionString:onlyCi(),max:3});
 const actor='ci-sow-'+randomUUID().slice(0,8);
 try{
  const uid='usr_sow_'+randomUUID(),lead='lead_sow_'+randomUUID();
  await db.query('INSERT INTO users(id,email,password_hash,created_at) VALUES($1,$2,$3,NOW())',
   [uid,'ci-sow-'+randomUUID()+'@example.invalid','synthetic']);
  await db.query('INSERT INTO sales_prospects '
   +'(id,company_name,source,created_by,created_at,updated_at) '
   +'VALUES($1,$2,$3,$4,NOW(),NOW())',
   [lead,'Synthetic SOW candidate','synthetic-ci',uid]);
  const opp=await createOpportunity(db,{
   prospect_id:lead,company_name_at_review:'Synthetic SOW candidate',
   next_action:'Document working scope; no testing',due_date:null
  },actor);
  const proposal=await createProposalDraft(db,{
   opportunity_id:opp.id,title:'Synthetic SOW demonstration',
   scope_text:'Purely documentary planned review, no live security testing.',
   currency:'GBP',amount_minor:75000
  },actor);
  assert.equal((await readSowDraft(db,proposal.id,actor)).current,null);
  await assert.rejects(()=>readSowDraft(db,proposal.id,'another-operator'),/not found/);
  const src={
   proposal_id:proposal.id,expected_revision:1,expected_sow_revision:0,confirmed:true,
   in_scope:'Human review of one documented AI agent workflow only.',
   out_of_scope:'No production-system access, penetration testing or exploitation.',
   deliverables:'Preliminary risk register, scope summary and review meeting.',
   acceptance_criteria:'Written report includes trust boundaries, risks and limitations.',
   target_inventory:'Documentary only; no verified technical target or permission.',
   dependencies:'Customer-provided diagrams and separately agreed written scope.',
   review_note:'This is synthetic SOW planning material; nobody accepted a scope.'
  };
  const r1=await recordSowDraft(db,src,actor);
  assert.equal(r1.sow_revision,1);assert.equal(r1.testing_authorised,false);
  const r2=await recordSowDraft(db,{...src,expected_sow_revision:1,
   acceptance_criteria:'Written report identifies documented interfaces, risks and limitations.'
  },actor);
  assert.equal(r2.sow_revision,2);
  const saved=await readSowDraft(db,proposal.id,actor);
  assert.equal(saved.current.sow_revision,2);
  assert.equal(saved.history.length,2);
  assert.equal(saved.current.status,'operator_draft_unapproved');
  assert.equal(saved.can_sign,false);
  const documentary=await readSowSources(db,proposal.id,actor);
  assert.equal(documentary.current_sow.sow_revision,2);
  assert.equal(documentary.current_sow.acceptance_criteria,
    'Written report identifies documented interfaces, risks and limitations.');
  assert.ok(!documentary.blockers.some(x=>x.includes('not separately documented')));
  assert.equal(documentary.contract_checks.find(x=>x.code==='agreement').status,
    'not_evidenced_in_workflow');
  assert.equal(documentary.contract_checks.find(x=>x.code==='dpa').status,
    'applicability_not_assessed');
  assert.equal(documentary.can_accept_engagement,false);
  assert.equal(documentary.testing_authorised,false);
  assert.equal((await db.query(
   'SELECT acceptance_criteria FROM enkyron_crm_sow_draft_versions '
   +'WHERE workspace_key=$1 AND proposal_id=$2 AND sow_revision=1',
   ['local:'+actor,proposal.id])).rows[0].acceptance_criteria,src.acceptance_criteria);
  await assert.rejects(()=>recordSowDraft(db,{...src,expected_sow_revision:1},actor),/concurrently/);
  await assert.rejects(()=>db.query(
   'UPDATE enkyron_crm_sow_draft_versions SET deliverables=$1 WHERE id=$2',
   ['Tampered',r1.id]),/cannot be changed|immutable/i);
  await assert.rejects(()=>db.query(
   'DELETE FROM enkyron_crm_sow_draft_versions WHERE id=$1',[r1.id]),
   /cannot be changed|immutable/i);
  const moved=await updateProposalDraft(db,{
   id:proposal.id,expected_revision:1,title:'Revised synthetic SOW',
   scope_text:'Purely documentary planned review, no live security testing.',
   currency:'GBP',amount_minor:75000
  },actor);
  assert.equal(moved.revision,2);
  const after=await readSowDraft(db,proposal.id,actor);
  assert.equal(after.current,null);
  assert.deepEqual(after.history.map(x=>x.sow_revision),[2,1]);
  const newPreview=await readSowSources(db,proposal.id,actor);
  assert.equal(newPreview.current_sow,null);
  assert.ok(newPreview.blockers.some(x=>x.includes('not separately documented')));
  assert.equal(newPreview.testing_authorised,false);
  await assert.rejects(()=>recordSowDraft(db,src,actor),/proposal revision changed/);
  const newBase=await recordSowDraft(db,{
   ...src,expected_revision:2,expected_sow_revision:0
  },actor);
  assert.equal(newBase.sow_revision,1);
  const quote=(await db.query(
   'SELECT revision,currency,amount_minor FROM enkyron_crm_proposal_drafts WHERE id=$1',
   [proposal.id])).rows[0];
  assert.equal(quote.revision,2);
  assert.equal(quote.currency,'GBP');
  assert.equal(Number(quote.amount_minor),75000);
 }finally{await db.end();}
});
