import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import pg from 'pg';
import {createOpportunity,updateOpportunity} from '../desktop/enkyron-crm-opportunities.mjs';
import {recordActivity,listActivityTimeline} from '../desktop/enkyron-crm-activities.mjs';

const database=process.env.ARL_CI_POSTGRES_URL||'';
function ephemeral(){
  assert.equal(process.env.CI,'true','Only isolated CI PostgreSQL is allowed');
  const uri=new URL(database);
  assert.equal(uri.hostname,'127.0.0.1');
  assert.equal(uri.pathname,'/arl_ci');
  assert.equal(uri.username,'arl_ci');
  assert.equal(uri.password,'synthetic-ci-only');
  return database;
}
test('PostgreSQL activity notes: immutable provenance, local isolation and no sends', {
  skip:!database&&'Dedicated disposable PostgreSQL only',
  timeout:45_000
},async()=>{
  const pool=new pg.Pool({connectionString:ephemeral(),max:3});
  const actor='ci-activity',other='ci-intruder';
  try{
    const userId='usr_activity_'+randomUUID();
    const prospectId='lead_activity_'+randomUUID();
    await pool.query('INSERT INTO users(id,email,password_hash,created_at) VALUES($1,$2,$3,$4)',
      [userId,'ci-'+randomUUID()+'@example.invalid','synthetic-only',new Date()]);
    await pool.query(
      'INSERT INTO sales_prospects(id,company_name,website,source,created_by,created_at,updated_at) '
      +'VALUES($1,$2,$3,$4,$5,NOW(),NOW())',
      [prospectId,'Synthetic Journal Prospect','https://example.invalid',
        'synthetic-ci',userId]
    );
    const opportunity=await createOpportunity(pool,{
      prospect_id:prospectId,company_name_at_review:'Synthetic Journal Prospect',
      next_action:'Prepare private research notes for operator review',
      due_date:'2026-11-06'
    },actor);
    const before=(await pool.query(
      'SELECT * FROM enkyron_crm_opportunities WHERE id=$1',[opportunity.id]
    )).rows[0];
    const counts=await Promise.all([
      pool.query('SELECT count(*)::int AS n FROM sales_messages'),
      pool.query('SELECT count(*)::int AS n FROM enkyron_crm_contacts'),
      pool.query('SELECT count(*)::int AS n FROM arl_workbench_tickets')
    ]);
    const note=await recordActivity(pool,{
      opportunity_id:opportunity.id,
      activity_type:'email_note',
      detail:'Drafted an introduction for internal review; no actual email transmitted.',
      reviewed:true
    },actor);
    assert.equal(note.opportunity_id,opportunity.id);
    const first=await listActivityTimeline(pool,opportunity.id,actor);
    assert.equal(first.available,true);
    assert.equal(first.items.length,2);
    assert.ok(first.items.some(x=>x.entry_kind==='activity'&&x.activity_type==='email_note'));
    assert.ok(first.items.some(x=>x.entry_kind==='change'&&x.event_type==='created'));
    assert.deepEqual((await pool.query(
      'SELECT * FROM enkyron_crm_opportunities WHERE id=$1',[opportunity.id]
    )).rows[0],before,'manual note must not update the opportunity version or stage');
    await assert.rejects(()=>listActivityTimeline(pool,opportunity.id,other),
      /opportunity not found/);
    await assert.rejects(()=>recordActivity(pool,{
      opportunity_id:opportunity.id,activity_type:'call_note',
      detail:'Unauthorized cross-operator note attempted',reviewed:true
    },other),/opportunity not found/);
    const updated=await updateOpportunity(pool,{
      id:opportunity.id,expected_version:1,stage:'qualified',
      next_action:'Prepare a human-approved message draft for review',
      due_date:'2026-11-10'
    },actor);
    assert.equal(updated.version,2);
    const entries=await listActivityTimeline(pool,opportunity.id,actor);
    assert.equal(entries.items.length,3);
    assert.ok(entries.items.some(x=>x.event_type==='updated'));
    const entry=(await pool.query(
      'SELECT activity_type,detail,recorded_by,workspace_key '
      +'FROM enkyron_crm_activities WHERE id=$1',[note.id]
    )).rows[0];
    assert.equal(entry.recorded_by,actor);
    assert.equal(entry.workspace_key,'local:'+actor);
    assert.match(entry.detail,/no actual email transmitted/);
    await assert.rejects(()=>pool.query(
      'UPDATE enkyron_crm_activities SET detail=$1 WHERE id=$2',
      ['Overwritten note',note.id]
    ),/cannot be changed or deleted/);
    await assert.rejects(()=>pool.query(
      'DELETE FROM enkyron_crm_activities WHERE id=$1',[note.id]
    ),/cannot be changed or deleted/);
    assert.equal((await pool.query(
      'SELECT count(*)::int AS n FROM enkyron_crm_activities WHERE id=$1',
      [note.id]
    )).rows[0].n,1);
    const finalCounts=await Promise.all([
      pool.query('SELECT count(*)::int AS n FROM sales_messages'),
      pool.query('SELECT count(*)::int AS n FROM enkyron_crm_contacts'),
      pool.query('SELECT count(*)::int AS n FROM arl_workbench_tickets')
    ]);
    assert.deepEqual(finalCounts.map(r=>r.rows[0].n),counts.map(r=>r.rows[0].n));
  }finally{await pool.end();}
});
