import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import pg from 'pg';
import {
  listOpportunities,prospectOpportunity,createOpportunity,updateOpportunity
} from '../desktop/enkyron-crm-opportunities.mjs';
const url=process.env.ARL_CI_POSTGRES_URL||'';
function isolated(){
  assert.equal(process.env.CI,'true','Only disposable CI PostgreSQL may be written');
  const value=new URL(url);
  assert.equal(value.hostname,'127.0.0.1');
  assert.equal(value.pathname,'/arl_ci');
  assert.equal(value.username,'arl_ci');
  assert.equal(value.password,'synthetic-ci-only');
  return url;
}
test('PostgreSQL: opportunity for a legacy prospect, versioned follow-up, immutable audit, no outreach', {
  skip:!url&&'Only ephemeral CI PostgreSQL',
  timeout:45_000
},async()=>{
  const pool=new pg.Pool({connectionString:isolated(),max:3});
  const actor='ci-followup';
  try{
    const userId='usr_followup_'+randomUUID();
    const prospectId='lead_followup_'+randomUUID();
    await pool.query('INSERT INTO users(id,email,password_hash,created_at) VALUES($1,$2,$3,$4)',
      [userId,'ci-'+randomUUID()+'@example.invalid','synthetic-only',new Date()]);
    await pool.query(
      'INSERT INTO sales_prospects(id,company_name,website,source,created_by,created_at,updated_at) '
      +'VALUES($1,$2,$3,$4,$5,NOW(),NOW())',
      [prospectId,'Synthetic Follow-up Research','https://example.invalid',
        'synthetic-ci',userId]
    );
    const priorSource=(await pool.query('SELECT * FROM sales_prospects WHERE id=$1',
      [prospectId])).rows[0];
    const priorMail=(await pool.query('SELECT count(*)::int AS n FROM sales_messages')).rows[0].n;
    const priorContacts=(await pool.query('SELECT count(*)::int AS n FROM enkyron_crm_contacts')).rows[0].n;
    const pending=await prospectOpportunity(pool,prospectId,actor);
    assert.equal(pending.available,true);
    assert.equal(pending.opportunity,null);
    const original=await createOpportunity(pool,{
      prospect_id:prospectId,company_name_at_review:'Synthetic Follow-up Research',
      next_action:'Review public technical background before contacting anyone',
      due_date:'2026-11-12'
    },actor);
    assert.equal(original.stage,'research');
    assert.equal(original.version,1);
    assert.equal((await pool.query(
      'SELECT probability_percent FROM enkyron_crm_opportunities WHERE id=$1',
      [original.id]
    )).rows[0].probability_percent,null);
    await assert.rejects(()=>createOpportunity(pool,{
      prospect_id:prospectId,company_name_at_review:'Synthetic Follow-up Research',
      next_action:'Do another research pass',due_date:null
    },actor),/duplicate key|unique constraint/i);
    const list=await listOpportunities(pool,'Synthetic Follow-up',actor);
    assert.ok(list.items.some(x=>x.id===original.id));
    assert.equal((await listOpportunities(pool,'Synthetic Follow-up','another-operator')).items
      .some(x=>x.id===original.id),false);
    assert.equal((await prospectOpportunity(pool,prospectId,actor)).opportunity.id,original.id);
    const updated=await updateOpportunity(pool,{
      id:original.id,expected_version:1,stage:'qualified',
      next_action:'Prepare a manual tailored follow-up for approval',
      due_date:'2026-11-19',probability_percent:35
    },actor);
    assert.equal(updated.version,2);
    assert.equal((await prospectOpportunity(pool,prospectId,actor)).opportunity.probability_percent,35);
    assert.equal((await listOpportunities(pool,'Synthetic Follow-up',actor)).items
      .find(x=>x.id===original.id).probability_percent,35);
    await assert.rejects(()=>updateOpportunity(pool,{
      id:original.id,expected_version:1,stage:'proposal',
      next_action:'Record proposal readiness',due_date:null
    },actor),/changed since opening/);
    await assert.rejects(()=>updateOpportunity(pool,{
      id:original.id,expected_version:2,stage:'qualified',
      next_action:'Prepare a manual tailored follow-up for approval',
      due_date:'2026-11-19'
    },actor),/no changes/);
    await assert.rejects(()=>updateOpportunity(pool,{
      id:original.id,expected_version:2,stage:'won',
      next_action:'Record customer discovery',due_date:null
    },'another-operator'),/not found/);
    const events=(await pool.query(
      'SELECT event_type,old_stage,new_stage,new_due_date,actor_local,'
      +'old_probability_percent,new_probability_percent '
      +'FROM enkyron_crm_opportunity_events WHERE opportunity_id=$1 '
      +'ORDER BY created_at,id',[original.id]
    )).rows;
    assert.equal(events.length,2);
    assert.equal(events[0].event_type,'created');
    assert.equal(events[0].new_stage,'research');
    assert.equal(events[1].event_type,'updated');
    assert.equal(events[1].old_stage,'research');
    assert.equal(events[1].new_stage,'qualified');
    assert.equal(events[0].new_probability_percent,null);
    assert.equal(events[1].old_probability_percent,null);
    assert.equal(events[1].new_probability_percent,35);
    assert.ok(events.every(x=>x.actor_local===actor));
    const cleared=await updateOpportunity(pool,{
      id:original.id,expected_version:2,stage:'qualified',
      next_action:'Prepare a manual tailored follow-up for approval',
      due_date:'2026-11-19',probability_percent:null
    },actor);
    assert.equal(cleared.version,3);
    const last=(await pool.query(
      'SELECT old_probability_percent,new_probability_percent FROM enkyron_crm_opportunity_events '
      +'WHERE opportunity_id=$1 ORDER BY created_at DESC,id DESC LIMIT 1',
      [original.id]
    )).rows[0];
    assert.equal(last.old_probability_percent,35);
    assert.equal(last.new_probability_percent,null);
    await assert.rejects(()=>updateOpportunity(pool,{
      id:original.id,expected_version:3,stage:'qualified',
      next_action:'Prepare a manual tailored follow-up for approval',
      due_date:'2026-11-19',probability_percent:101
    },actor),/probability/);
    await assert.rejects(()=>pool.query(
      'DELETE FROM enkyron_crm_opportunity_events WHERE opportunity_id=$1',
      [original.id]
    ),/cannot be changed or deleted/);
    assert.deepEqual((await pool.query('SELECT * FROM sales_prospects WHERE id=$1',
      [prospectId])).rows[0],priorSource);
    assert.equal((await pool.query('SELECT count(*)::int AS n FROM sales_messages')).rows[0].n,priorMail);
    assert.equal((await pool.query('SELECT count(*)::int AS n FROM enkyron_crm_contacts')).rows[0].n,priorContacts);
    assert.equal((await pool.query(
      'SELECT count(*)::int AS n FROM enkyron_crm_opportunities WHERE id=$1',
      [original.id]
    )).rows[0].n,1);
  }finally{await pool.end();}
});
