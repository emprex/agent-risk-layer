import test from 'node:test';
import assert from 'node:assert/strict';
import pg from 'pg';
import {createDeskTicket} from '../desktop/enkyron-ticket-intake.mjs';
import {recordTicketTriage,readTicketTriage} from '../desktop/enkyron-ticket-triage.mjs';

const db=process.env.ARL_CI_POSTGRES_URL||'';
function disposable(){
  assert.equal(process.env.CI,'true','Temporary CI database required');
  const u=new URL(db);
  assert.equal(u.hostname,'127.0.0.1');
  assert.equal(u.pathname,'/arl_ci');
  assert.equal(u.username,'arl_ci');
  assert.equal(u.password,'synthetic-ci-only');
  return db;
}
const note='Synthetic human triage with explicit scope and no authorisation to test.';
test('E03 triage is append-only and survives readback, rejects stale writes', {
  skip:!db&&'CI PostgreSQL only', timeout:45_000
},async()=>{
  const pool=new pg.Pool({connectionString:disposable(),max:3});
  try{
    const ticket=await createDeskTicket(pool,{
      source:'manual',client_name:'CI Synthetic E03 Customer',
      title:'E03 business qualification',request_text:'Triage test only; no assessment.'
    },'ci-e03');
    const first=await readTicketTriage(pool,ticket.id);
    assert.equal(first.available,true);
    assert.equal(first.current,null);
    const input={
      ticket_id:ticket.id,request_type:'consultation',impact:'low',
      urgency:'medium',priority:'normal',review_note:note,
      expected_latest_id:null,confirmed:true
    };
    const created=await recordTicketTriage(pool,input,'ci-e03');
    assert.equal(created.request_type,'consultation');
    assert.equal(created.priority,'normal');
    const saved=await readTicketTriage(pool,ticket.id);
    assert.equal(saved.current.id,created.id);
    assert.equal(saved.current.recorded_by,'ci-e03');
    await assert.rejects(()=>recordTicketTriage(pool,input,'ci-e03'),/changed/);
    await assert.rejects(()=>recordTicketTriage(pool,{
      ...input,expected_latest_id:created.id
    },'ci-e03'),/values unchanged/);
    const reviewed=await recordTicketTriage(pool,{
      ...input,request_type:'assessment_request',impact:'medium',
      priority:'high',expected_latest_id:created.id,
      review_note:'Operator reviewed source and adjusted internal priority; no approval issued.'
    },'ci-e03');
    assert.notEqual(reviewed.id,created.id);
    const current=await readTicketTriage(pool,ticket.id);
    assert.equal(current.current.id,reviewed.id);
    assert.equal(current.current.priority,'high');
    assert.equal((await pool.query(
      'SELECT COUNT(*)::int AS n FROM enkyron_ticket_triage_reviews WHERE ticket_id=$1',
      [ticket.id]
    )).rows[0].n,2);
    await assert.rejects(()=>pool.query(
      'DELETE FROM enkyron_ticket_triage_reviews WHERE id=$1',[created.id]
    ));
    const original=(await pool.query(
      'SELECT status,linked_project_id,linked_assessment_id FROM arl_workbench_tickets WHERE id=$1',
      [ticket.id]
    )).rows[0];
    assert.equal(original.status,'new');
    assert.equal(original.linked_project_id,null);
    assert.equal(original.linked_assessment_id,null);
    await pool.query(
      'UPDATE arl_workbench_tickets SET archived_at=now() WHERE id=$1',
      [ticket.id]
    );
    await assert.rejects(()=>recordTicketTriage(pool,{
      ...input,expected_latest_id:reviewed.id
    },'ci-e03'),/Closed or archived/);
  }finally{await pool.end();}
});
