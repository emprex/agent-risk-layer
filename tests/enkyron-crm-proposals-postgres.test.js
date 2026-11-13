import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import pg from 'pg';
import {createOpportunity} from '../desktop/enkyron-crm-opportunities.mjs';
import {createProposalDraft,updateProposalDraft,readProposalDraft,listProposalDrafts}
  from '../desktop/enkyron-crm-proposals.mjs';
const url=process.env.ARL_CI_POSTGRES_URL||'';
function disposable(){
  assert.equal(process.env.CI,'true','Only disposable CI data may be created');
  const u=new URL(url);
  assert.equal(u.hostname,'127.0.0.1');
  assert.equal(u.pathname,'/arl_ci');
  assert.equal(u.username,'arl_ci');
  assert.equal(u.password,'synthetic-ci-only');
  return url;
}
test('PostgreSQL commercial proposals: exact operator prices, revisions, workspace and no delivery', {
  skip:!url&&'Disposable PostgreSQL CI only',timeout:45_000
},async()=>{
  const pool=new pg.Pool({connectionString:disposable(),max:3});
  const owner='ci-proposal-'+randomUUID().slice(0,8),other='ci-other';
  try{
    const user='usr_proposal_'+randomUUID(),lead='lead_proposal_'+randomUUID();
    await pool.query('INSERT INTO users(id,email,password_hash,created_at) VALUES($1,$2,$3,NOW())',
      [user,'ci-'+randomUUID()+'@example.invalid','ci-only']);
    await pool.query('INSERT INTO sales_prospects '
      +'(id,company_name,source,created_by,created_at,updated_at) '
      +'VALUES($1,$2,$3,$4,NOW(),NOW())',
      [lead,'Synthetic proposal prospect','synthetic-ci',user]);
    const opportunity=await createOpportunity(pool,{
      prospect_id:lead,company_name_at_review:'Synthetic proposal prospect',
      next_action:'Manually review possible engagement and draft scope',
      due_date:'2026-11-12'
    },owner);
    const oldOpportunity=(await pool.query('SELECT * FROM enkyron_crm_opportunities WHERE id=$1',
      [opportunity.id])).rows[0];
    const oldProspect=(await pool.query('SELECT * FROM sales_prospects WHERE id=$1',[lead])).rows[0];
    const before=(await Promise.all([
      pool.query('SELECT count(*)::int AS n FROM sales_messages'),
      pool.query('SELECT count(*)::int AS n FROM arl_workbench_tickets'),
      pool.query('SELECT count(*)::int AS n FROM enkyron_crm_mail_drafts')
    ])).map(x=>x.rows[0].n);
    const draft=await createProposalDraft(pool,{
      opportunity_id:opportunity.id,title:'Agent tools security proposal',
      scope_text:'Human-led review of selected tools and workflow boundaries, subject to client approval.',
      currency:'GBP',amount_minor:125050
    },owner);
    assert.equal(draft.revision,1);
    assert.equal((await readProposalDraft(pool,draft.id,owner)).proposal.amount_minor,'125050');
    const list=await listProposalDrafts(pool,'Agent tools',owner);
    assert.equal(list.items.length,1);
    assert.ok(!('scope_text' in list.items[0]));
    assert.equal(list.items[0].company_name_at_creation,'Synthetic proposal prospect');
    assert.equal((await listProposalDrafts(pool,'',other)).items.length,0);
    await assert.rejects(()=>readProposalDraft(pool,draft.id,other),/not found/);
    await assert.rejects(()=>createProposalDraft(pool,{
      opportunity_id:opportunity.id,title:'Unauthorized price proposal',
      scope_text:'This operator has not been assigned this opportunity.',
      currency:'GBP',amount_minor:1
    },other),/opportunity not found/);
    const updated=await updateProposalDraft(pool,{
      id:draft.id,expected_revision:1,title:'Updated agent tools security proposal',
      scope_text:'Reviewed manual price and scope, with no automatic tax or external message.',
      currency:'EUR',amount_minor:250075
    },owner);
    assert.equal(updated.revision,2);
    const current=await readProposalDraft(pool,draft.id,owner);
    assert.equal(current.proposal.currency,'EUR');
    assert.equal(current.proposal.amount_minor,'250075');
    assert.equal(current.proposal.revision,2);
    await assert.rejects(()=>updateProposalDraft(pool,{
      id:draft.id,expected_revision:1,title:'Outdated edit proposal',
      scope_text:'This would overwrite the valid revision and must be rejected.',
      currency:'GBP',amount_minor:900
    },owner),/changed since/);
    await assert.rejects(()=>updateProposalDraft(pool,{
      id:draft.id,expected_revision:2,title:'Unauthorized edit proposal',
      scope_text:'Not allowed to update another operators commercial proposal.',
      currency:'GBP',amount_minor:900
    },other),/not found/);
    const events=(await pool.query(
      'SELECT revision,event_type,content_sha256,actor_local '
      +'FROM enkyron_crm_proposal_draft_events WHERE proposal_id=$1 ORDER BY revision',
      [draft.id]
    )).rows;
    assert.deepEqual(events.map(x=>[x.revision,x.event_type]),[
      [1,'created'],[2,'edited']
    ]);
    assert.ok(events.every(x=>x.actor_local===owner&&/^[a-f0-9]{64}$/.test(x.content_sha256)));
    await assert.rejects(()=>pool.query(
      'DELETE FROM enkyron_crm_proposal_draft_events WHERE proposal_id=$1',
      [draft.id]
    ),/cannot be changed or deleted/);
    assert.deepEqual((await pool.query('SELECT * FROM enkyron_crm_opportunities WHERE id=$1',
      [opportunity.id])).rows[0],oldOpportunity);
    assert.deepEqual((await pool.query('SELECT * FROM sales_prospects WHERE id=$1',
      [lead])).rows[0],oldProspect);
    const after=(await Promise.all([
      pool.query('SELECT count(*)::int AS n FROM sales_messages'),
      pool.query('SELECT count(*)::int AS n FROM arl_workbench_tickets'),
      pool.query('SELECT count(*)::int AS n FROM enkyron_crm_mail_drafts')
    ])).map(x=>x.rows[0].n);
    assert.deepEqual(after,before);
  }finally{await pool.end();}
});
