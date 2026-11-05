import test from 'node:test';
import assert from 'node:assert/strict';
import pg from 'pg';
import {
  createDeskTicket, assignDeskTicket, updateDeskTicketStatus,
  archiveDeskTicket
} from '../desktop/enkyron-ticket-intake.mjs';

const url=process.env.ARL_CI_POSTGRES_URL || '';
function ephemeral() {
  assert.equal(process.env.CI,'true','CI isolation is mandatory');
  const u=new URL(url);
  assert.equal(u.hostname,'127.0.0.1');
  assert.equal(u.pathname,'/arl_ci');
  assert.equal(u.username,'arl_ci');
  assert.equal(u.password,'synthetic-ci-only');
  return url;
}
test('real temporary PostgreSQL round-trip: phone intake, assignment, closure, archival', {
  skip:!url && 'Only disposable GitHub Actions Postgres may be tested',
  timeout:45_000
},async()=>{
  const pool=new pg.Pool({connectionString:ephemeral(),max:2});
  try{
    const intake=await createDeskTicket(pool,{
      source:'phone',client_name:'CI Sample Company',
      contact_name:'Synthetic Caller',contact_phone:'0000 0000',
      contact_email:'caller@example.invalid',
      title:'Internal intake acceptance',
      request_text:'Synthetic request for Client Desk functionality.'
    },'ci-operator');
    assert.match(intake.ticket_number,/^ARL-\d{4}-\d+$/);
    const fetch=()=>pool.query(
      'SELECT * FROM arl_workbench_tickets WHERE id=$1',[intake.id]
    ).then(r=>r.rows[0]);
    const created=await fetch();
    assert.equal(created.status,'new');
    assert.equal(created.assigned_to,null);
    assert.equal(created.archived_at,null);
    assert.match(created.scope_text,/Telephone: 0000 0000/);
    await assignDeskTicket(pool,{ticket_id:intake.id,action:'self'},'ci-operator');
    assert.equal((await fetch()).assigned_to,'ci-operator');

    const transitions=['scoping','in_progress','pending_review','resolved','closed'];
    for(const status of transitions) {
      await updateDeskTicketStatus(pool,{ticket_id:intake.id,status});
    }
    await assert.rejects(
      ()=>archiveDeskTicket(pool,{ticket_id:intake.id,reason:'short'},'ci-operator'),
      /Archive reason/
    );
    const closed=await fetch();
    assert.equal(closed.status,'closed');
    assert.equal(closed.archived_at,null);
    const archived=await archiveDeskTicket(pool,{
      ticket_id:intake.id,reason:'Synthetic closed ticket retained for the audit history'
    },'ci-operator');
    assert.equal(archived.archived,true);
    const final=await fetch();
    assert.ok(final.archived_at);
    assert.equal(final.archived_by,'ci-operator');
    assert.equal(final.assigned_to,'ci-operator');
    const history=(await pool.query(
      'SELECT event_type,actor FROM arl_workbench_ticket_events WHERE ticket_id=$1 ORDER BY created_at,id',
      [intake.id]
    )).rows;
    assert.equal(history.filter(x=>x.event_type==='created').length,1);
    assert.equal(history.filter(x=>x.event_type==='assigned').length,1);
    assert.equal(history.filter(x=>x.event_type==='status_changed').length,5);
    assert.equal(history.filter(x=>x.event_type==='archived').length,1);
    assert.ok(history.every(x=>x.actor==='ci-operator'));
    await assert.rejects(
      ()=>updateDeskTicketStatus(pool,{ticket_id:intake.id,status:'in_progress'}),
      /Archived ticket/
    );
    const retained=(await pool.query(
      'SELECT COUNT(*)::int AS n FROM arl_workbench_ticket_events WHERE ticket_id=$1',
      [intake.id]
    )).rows[0].n;
    assert.equal(retained,8);
  }finally{await pool.end();}
});
