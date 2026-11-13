import test from 'node:test';
import assert from 'node:assert/strict';
import pg from 'pg';
import {createCompany} from '../desktop/enkyron-crm.mjs';
import {linkTicketToCompany,ticketLinkedCompany} from '../desktop/enkyron-crm-tickets.mjs';
import {recordTicketTriage} from '../desktop/enkyron-ticket-triage.mjs';
import {recordTicketAction} from '../desktop/enkyron-ticket-actions.mjs';
import {
  createDeskTicket, assignDeskTicket, listDeskTickets, updateDeskTicketStatus,
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
    // Server-side My Tickets filter may only use the actual OS principal
    // supplied by the bridge, never an assignee injected by the UI.
    const own=await listDeskTickets(pool,intake.ticket_number,'ci-operator',{mineOnly:true});
    assert.ok(own.items.some(row=>row.id===intake.id && row.assigned_to==='ci-operator'));
    const other=await listDeskTickets(pool,intake.ticket_number,'different-operator',{mineOnly:true});
    assert.ok(!other.items.some(row=>row.id===intake.id));


    // ENK-05 integrated disposable-CI journey: real canonical company link,
    // human triage and scheduled work in the same exact ticket.
    const company=await createCompany(pool,{name:'CI Sample Company'},'ci-operator');
    const association=await linkTicketToCompany(pool,{
      company_id:company.id,ticket_id:intake.id,
      ticket_client_name_at_review:'CI Sample Company',
      review_note:'Operator checked the canonical company and exact source ticket ID before linking.',
      reviewed:true
    },'ci-operator');
    assert.equal(association.ticket_id,intake.id);
    assert.equal((await ticketLinkedCompany(pool,intake.id,'ci-operator')).link.company_id,company.id);
    assert.equal((await ticketLinkedCompany(pool,intake.id,'not-the-operator')).link,null);
    const triage=await recordTicketTriage(pool,{
      ticket_id:intake.id,request_type:'support_request',
      impact:'medium',urgency:'high',priority:'high',
      expected_latest_id:null,confirmed:true,
      review_note:'Human operator examined the synthetic request and assigned high priority.'
    },'ci-operator');
    assert.equal(triage.priority,'high');
    const action=await recordTicketAction(pool,{
      ticket_id:intake.id,action_id:null,expected_revision:null,
      title:'Call customer to confirm outcome',
      details:'Synthetic planning only, no external contact is performed.',
      due_on:'2026-11-16',state:'todo',
      rationale:'Schedule a human follow-up after the internal review.',
      confirmed:true
    },'ci-operator');
    assert.equal(action.ticket_id,intake.id);
    const prioritised=await listDeskTickets(pool,intake.ticket_number,'ci-operator',{mineOnly:true});
    const queueRecord=prioritised.items.find(row=>row.id===intake.id);
    assert.ok(queueRecord);
    assert.equal(queueRecord.priority,'high');
    assert.equal(queueRecord.next_action_title,'Call customer to confirm outcome');
    assert.equal(new Date(queueRecord.next_due_on).toISOString().slice(0,10),'2026-11-16');

    const transitions=['scoping','waiting','in_progress','pending_review','resolved','closed'];
    let previous='new';
    for(const status of transitions) {
      const humanCompletion=['resolved','closed'].includes(status);
      const input={ticket_id:intake.id,status};
      if(humanCompletion)Object.assign(input,{
        expected_status:previous,confirmed:true,
        review_note:'CI human operator reviewed the completed synthetic support work and closure evidence.'
      });
      const saved=await updateDeskTicketStatus(pool,input,'ci-operator');
      assert.equal(saved.from,previous);
      if(humanCompletion)assert.match(saved.event_id,/^[0-9a-f-]{36}$/);
      previous=status;
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
    assert.equal(history.filter(x=>x.event_type==='status_changed').length,6);
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
    assert.equal(retained,9);
  }finally{await pool.end();}
});
