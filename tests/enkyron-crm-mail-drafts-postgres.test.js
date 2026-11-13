import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import pg from 'pg';
import {createOpportunity} from '../desktop/enkyron-crm-opportunities.mjs';
import {createMailDraft,readMailDraft,listMailDrafts,updateMailDraft}
  from '../desktop/enkyron-crm-mail-drafts.mjs';
const url=process.env.ARL_CI_POSTGRES_URL||'';
function ephemeral(){
  assert.equal(process.env.CI,'true','Only disposable CI database is authorized');
  const uri=new URL(url);
  assert.equal(uri.hostname,'127.0.0.1');
  assert.equal(uri.pathname,'/arl_ci');
  assert.equal(uri.username,'arl_ci');
  assert.equal(uri.password,'synthetic-ci-only');
  return url;
}
test('PostgreSQL unsent mail drafts: scoped, versioned and non-delivering', {
  skip:!url && 'Only disposable CI PostgreSQL',
  timeout:45_000
},async()=>{
  const pool=new pg.Pool({connectionString:ephemeral(),max:3});
  const owner='ci-mail-drafts',other='ci-mail-other';
  try{
    const user='usr_mail_'+randomUUID(),lead='lead_mail_'+randomUUID();
    await pool.query('INSERT INTO users(id,email,password_hash,created_at) VALUES($1,$2,$3,$4)',
      [user,'ci-'+randomUUID()+'@example.invalid','ci-only',new Date()]);
    await pool.query('INSERT INTO sales_prospects '
      +'(id,company_name,source,created_by,created_at,updated_at) '
      +'VALUES($1,$2,$3,$4,NOW(),NOW())',
      [lead,'Synthetic Mail Prospect','synthetic-ci',user]);
    const opportunity=await createOpportunity(pool,{
      prospect_id:lead,company_name_at_review:'Synthetic Mail Prospect',
      next_action:'Manually review a possible proposal',due_date:'2026-11-12'
    },owner);
    const sourceBefore=(await pool.query(
      'SELECT * FROM sales_prospects WHERE id=$1',[lead]
    )).rows[0];
    const opportunityBefore=(await pool.query(
      'SELECT * FROM enkyron_crm_opportunities WHERE id=$1',
      [opportunity.id]
    )).rows[0];
    const counts=await Promise.all([
      pool.query('SELECT count(*)::int AS n FROM sales_messages'),
      pool.query('SELECT count(*)::int AS n FROM enkyron_crm_activities'),
      pool.query('SELECT count(*)::int AS n FROM enkyron_crm_contacts')
    ]);
    const created=await createMailDraft(pool,{
      opportunity_id:opportunity.id,recipient_email:'',
      subject:'Possible proposal (internal draft)',
      body_text:'Hello,\nThis is a local example, not sent.'
    },owner);
    assert.equal(created.revision,1);
    const saved=await readMailDraft(pool,created.id,owner);
    assert.equal(saved.draft.recipient_email,null);
    assert.equal(saved.draft.revision,1);
    assert.match(saved.draft.body_text,/not sent/);
    const indexed=await listMailDrafts(pool,'Possible proposal',owner);
    assert.ok(indexed.items.some(x=>x.id===created.id));
    assert.ok(indexed.items.every(x=>!('body_text' in x)));
    assert.equal((await listMailDrafts(pool,'Possible proposal',other)).items.length,0);
    await assert.rejects(()=>readMailDraft(pool,created.id,other),/draft not found/);
    await assert.rejects(()=>createMailDraft(pool,{
      opportunity_id:opportunity.id,recipient_email:'',
      subject:'Unauthorized',body_text:'Attempted cross-scope draft'
    },other),/opportunity not found/);
    const revision=await updateMailDraft(pool,{
      id:created.id,expected_revision:1,
      recipient_email:'manual@example.invalid',subject:'Proposal for internal review',
      body_text:'Updated plain-text draft, still not transmitted.'
    },owner);
    assert.equal(revision.revision,2);
    const current=await readMailDraft(pool,created.id,owner);
    assert.equal(current.draft.revision,2);
    assert.equal(current.draft.recipient_email,'manual@example.invalid');
    await assert.rejects(()=>updateMailDraft(pool,{
      id:created.id,expected_revision:1,recipient_email:'',
      subject:'Old revision',body_text:'Overwrite newer draft'
    },owner),/changed/);
    await assert.rejects(()=>updateMailDraft(pool,{
      id:created.id,expected_revision:2,recipient_email:'',
      subject:'Unauthorized',body_text:'Operator isolation'
    },other),/not found/);
    const events=(await pool.query(
      'SELECT revision,event_type,content_sha256,actor_local '
      +'FROM enkyron_crm_mail_draft_events WHERE draft_id=$1 ORDER BY revision',
      [created.id]
    )).rows;
    assert.deepEqual(events.map(x=>[x.revision,x.event_type]),[
      [1,'created'],[2,'edited']
    ]);
    assert.ok(events.every(x=>x.actor_local===owner&&/^[a-f0-9]{64}$/.test(x.content_sha256)));
    await assert.rejects(()=>pool.query(
      'DELETE FROM enkyron_crm_mail_draft_events WHERE draft_id=$1',
      [created.id]
    ),/cannot be changed or deleted/);
    assert.deepEqual((await pool.query(
      'SELECT * FROM sales_prospects WHERE id=$1',[lead]
    )).rows[0],sourceBefore);
    assert.deepEqual((await pool.query(
      'SELECT * FROM enkyron_crm_opportunities WHERE id=$1',[opportunity.id]
    )).rows[0],opportunityBefore);
    const after=await Promise.all([
      pool.query('SELECT count(*)::int AS n FROM sales_messages'),
      pool.query('SELECT count(*)::int AS n FROM enkyron_crm_activities'),
      pool.query('SELECT count(*)::int AS n FROM enkyron_crm_contacts')
    ]);
    assert.deepEqual(after.map(r=>r.rows[0].n),counts.map(r=>r.rows[0].n));
  }finally{await pool.end();}
});
