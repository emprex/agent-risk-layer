import test from 'node:test';
import assert from 'node:assert/strict';
import pg from 'pg';
import {createDeskTicket} from '../desktop/enkyron-ticket-intake.mjs';
import {recordTicketAction,listTicketActions} from '../desktop/enkyron-ticket-actions.mjs';

const db=process.env.ARL_CI_POSTGRES_URL||'';
function disposable(){
  assert.equal(process.env.CI,'true','Only temporary CI PostgreSQL allowed');
  const u=new URL(db);
  assert.equal(u.hostname,'127.0.0.1');
  assert.equal(u.pathname,'/arl_ci');
  assert.equal(u.username,'arl_ci');
  assert.equal(u.password,'synthetic-ci-only');
  return db;
}
const reason='Synthetic operator reviewed the new internal ticket action.';
test('E03-04A versioned ticket checklist persists without test authorisation',{
  skip:!db&&'CI PostgreSQL only',timeout:45000
},async()=>{
  const pool=new pg.Pool({connectionString:disposable(),max:3});
  try{
    const ticket=await createDeskTicket(pool,{
      source:'manual',client_name:'CI E03 synthetic',
      title:'E03 internal planning ticket',
      request_text:'Work planning only; no customer agreement or test authorisation.'
    },'ci-e03-actions');
    const blank=await listTicketActions(pool,ticket.id);
    assert.equal(blank.available,true);
    assert.equal(blank.items.length,0);
    const data={
      ticket_id:ticket.id,action_id:null,expected_revision:null,
      title:'Inspect source scope before requesting authorisation',
      details:'No network action is permitted by recording this task.',
      due_on:'2026-12-05',state:'todo',rationale:reason,confirmed:true
    };
    const created=await recordTicketAction(pool,data,'ci-e03-actions');
    assert.equal(created.revision,1);
    assert.equal(created.state,'todo');
    const read=await listTicketActions(pool,ticket.id);
    assert.equal(read.items.length,1);
    assert.equal(read.items[0].action_id,created.action_id);
    const update=await recordTicketAction(pool,{
      ...data,action_id:created.action_id,expected_revision:1,
      state:'blocked',rationale:'No client authorisation; task remains blocked.'
    },'ci-e03-actions');
    assert.equal(update.revision,2);
    assert.equal(update.state,'blocked');
    await assert.rejects(()=>recordTicketAction(pool,{
      ...data,action_id:created.action_id,expected_revision:1,
      state:'done'
    },'ci-e03-actions'),/changed/);
    assert.equal((await listTicketActions(pool,ticket.id)).items[0].state,'blocked');
    assert.equal((await pool.query(
      'SELECT COUNT(*)::int AS total FROM enkyron_ticket_action_versions WHERE action_id=$1',
      [created.action_id]
    )).rows[0].total,2);
    await assert.rejects(()=>pool.query(
      'UPDATE enkyron_ticket_action_versions SET state=\'done\' WHERE event_id=$1',
      [created.event_id]
    ));
    const origin=(await pool.query(
      'SELECT status,linked_project_id,linked_assessment_id FROM arl_workbench_tickets WHERE id=$1',
      [ticket.id]
    )).rows[0];
    assert.equal(origin.status,'new');
    assert.equal(origin.linked_project_id,null);
    assert.equal(origin.linked_assessment_id,null);
    await pool.query('UPDATE arl_workbench_tickets SET archived_at=now() WHERE id=$1',
      [ticket.id]);
    await assert.rejects(()=>recordTicketAction(pool,{
      ...data,action_id:created.action_id,expected_revision:2,state:'done'
    },'ci-e03-actions'),/Closed or archived/);
  }finally{await pool.end();}
});
