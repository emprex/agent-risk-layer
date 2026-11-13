import test from 'node:test';
import assert from 'node:assert/strict';
import {
  validateIntake, validateStatusChange, createDeskTicket,
  updateDeskTicketStatus, TICKET_TRANSITIONS,
  validateAssignment, assignDeskTicket, validateArchive, archiveDeskTicket
} from '../desktop/enkyron-ticket-intake.mjs';

const ticketId = '1111111a-2222-4333-8444-555555555555';
const call = {
  source:'phone', client_name:'Example Co', contact_name:'A. Customer',
  contact_phone:'+44 200 000 0000', contact_email:'help@example.invalid',
  title:'Request a consultation', request_text:'Customer called to discuss a security review.'
};
function fakePool({previous='new', sequence='42', assignee=null, archivedAt=null}={}) {
  const calls=[];
  const db={
    query:async (sql,params)=>{
      calls.push({sql,params});
      if (sql.includes('nextval(')) return {rows:[{n:sequence}]};
      if (sql.includes('FOR UPDATE')) return {
        rows:previous===null?[]:[{status:previous,assessor_name:'localoperator', assigned_to:assignee, archived_at:archivedAt}]
      };
      return {rows:[]};
    },
    release:()=>calls.push({sql:'RELEASE'})
  };
  return {calls,connect:async()=>db};
}

test('human local telephone ticket validates channel and contact data',()=>{
  const record=validateIntake(call);
  assert.equal(record.title,call.title);
  assert.equal(record.source,'phone');
  assert.match(record.scope,/Customer request:/);
  assert.match(record.scope,/Telephone: \+44 200 000 0000/);
  assert.match(record.scope,/Email: help@example\.invalid/);
  assert.ok(record.scope.length<4000);
  assert.equal(validateIntake({...call,source:'manual'}).source,'manual');
});

test('refuses fake web/email ingestion, oversize or blank request',()=>{
  for(const invalid of [
    {...call,source:'email'}, {...call,source:'website'},
    {...call,source:'phone',title:''},
    {...call,client_name:'  '},
    {...call,request_text:'x'.repeat(3501)},
    {...call,contact_email:'invalid'},
    {...call,contact_name:'foo\u0000bar'},
    {...call,source:'manual', contact_name:'x'.repeat(161)}
  ]) assert.throws(()=>validateIntake(invalid));
});

test('creation writes one planning ticket and one history event atomically',async()=>{
  const db=fakePool();let count=0;
  const result=await createDeskTicket(db,call,'emprex',{
    now:new Date('2026-11-05T17:00:00Z'),
    uuid:()=>count++===0?ticketId:'00000000-0000-4000-8000-000000000002'
  });
  assert.deepEqual(result,{
    id:ticketId,ticket_number:'ARL-2026-000042',status:'new',source:'phone'
  });
  const actions=db.calls.map(x=>x.sql);
  assert.equal(actions[0],'BEGIN');
  assert.ok(actions[1].includes("nextval('arl_ticket_number_sequence')"));
  assert.match(actions[2],/INSERT INTO arl_workbench_tickets/);
  assert.match(actions[3],/INSERT INTO arl_workbench_ticket_events/);
  assert.equal(actions[4],'COMMIT');
  assert.equal(actions[5],'RELEASE');
  assert.equal(db.calls[2].params[6],'intake:phone');
  assert.equal(db.calls[2].params[5],'other');
  assert.equal(db.calls[2].params[8],'emprex');
  assert.match(db.calls[3].params[2],/no assessment created/);
  assert.doesNotMatch(actions.join(' '), /INSERT INTO assessments|INSERT INTO security_projects|UPDATE assessment_master/);
});

test('ticket status has same allowed transitions as the existing Workbench',()=>{
  assert.deepEqual(TICKET_TRANSITIONS.new,['scoping','waiting']);
  assert.deepEqual(TICKET_TRANSITIONS.closed,['in_progress']);
  assert.throws(()=>validateStatusChange({ticket_id:'x',status:'closed'}));
  assert.throws(()=>validateStatusChange({ticket_id:ticketId,status:'arbitrary'}));
  assert.deepEqual(validateStatusChange({ticket_id:ticketId,status:'waiting'}),{
    ticketId,status:'waiting'
  });
});

test('status change locks ticket and creates chronological event',async()=>{
  const db=fakePool({previous:'new'});
  const result=await updateDeskTicketStatus(db,{ticket_id:ticketId,status:'scoping'});
  assert.deepEqual(result,{ticket_id:ticketId,from:'new',status:'scoping'});
  assert.equal(db.calls[0].sql,'BEGIN');
  assert.match(db.calls[1].sql,/FOR UPDATE/);
  assert.match(db.calls[2].sql,/UPDATE arl_workbench_tickets/);
  assert.deepEqual(db.calls[2].params,['scoping',ticketId]);
  assert.match(db.calls[3].sql,/status_changed/);
  assert.equal(db.calls[3].params[3],'localoperator');
  assert.equal(db.calls[4].sql,'COMMIT');
});

test('unauthorised status jump and unknown ticket never update records',async()=>{
  for(const previous of ['new',null]) {
    const db=fakePool({previous});
    await assert.rejects(
      ()=>updateDeskTicketStatus(db,{ticket_id:ticketId,status:'closed'}),
      previous===null?/Ticket not found/:/Status transition not allowed/
    );
    assert.deepEqual(db.calls.map(x=>x.sql),[
      'BEGIN','SELECT status,assessor_name,archived_at FROM arl_workbench_tickets WHERE id=$1 FOR UPDATE',
      'ROLLBACK','RELEASE'
    ]);
  }
});


test('self-assignment is atomic and records a separate owner, not an assessor rewrite', async()=>{
  const db=fakePool();
  const result=await assignDeskTicket(db,{ticket_id:ticketId,action:'self'},'localoperator',
    {uuid:()=> '00000000-0000-4000-8000-000000000003'});
  assert.deepEqual(result,{ticket_id:ticketId,assigned_to:'localoperator'});
  const ops=db.calls.map(x=>x.sql);
  assert.deepEqual([ops[0],ops.at(-2),ops.at(-1)],['BEGIN','COMMIT','RELEASE']);
  assert.match(ops[2],/SET assigned_to=\$1/);
  assert.deepEqual(db.calls[2].params,['localoperator',ticketId]);
  assert.equal(db.calls[3].params[2],'assigned');
  assert.equal(db.calls[3].params[4],'localoperator');
  assert.doesNotMatch(ops.join(' '),/SET assessor_name/);
});

test('can unassign self, but cannot reassign another owner',async()=>{
  const db=fakePool({assignee:'localoperator'});
  const result=await assignDeskTicket(db,{ticket_id:ticketId,action:'unassigned'},'localoperator');
  assert.equal(result.assigned_to,null);
  assert.equal(db.calls[3].params[2],'unassigned');
  for(const action of ['unassigned','self']){
    const foreign=fakePool({assignee:'otheroperator'});
    await assert.rejects(
      ()=>assignDeskTicket(foreign,{ticket_id:ticketId,action},'localoperator'),
      /Only the assigned|already assigned/
    );
    assert.equal(foreign.calls[2].sql,'ROLLBACK');
    assert.equal(foreign.calls.some(x=>/UPDATE arl_workbench_tickets/.test(x.sql)),false);
  }
  assert.throws(()=>validateAssignment({ticket_id:ticketId,action:'otheroperator'}));
});

test('archiving requires CLOSED ticket, reason and operator confirmation in UI',async()=>{
  const good={ticket_id:ticketId,reason:'Customer request completed and documented'};
  assert.equal(validateArchive(good).ticketId,ticketId);
  const db=fakePool({previous:'closed'});
  const result=await archiveDeskTicket(db,good,'localoperator',
    {uuid:()=> '00000000-0000-4000-8000-000000000004'});
  assert.equal(result.archived,true);
  assert.equal(result.archived_by,'localoperator');
  const ops=db.calls.map(x=>x.sql);
  assert.match(ops[2],/SET archived_at=NOW\(\)/);
  assert.match(ops[3],/archived/);
  assert.equal(db.calls[3].params[2], 'Archive reason: '+good.reason);
  assert.equal(ops[4],'COMMIT');
  assert.doesNotMatch(ops.join(' '),/\bDELETE FROM\b|DROP TABLE/);
  assert.throws(()=>validateArchive({...good,reason:'short'}));
});

test('open/already archived tickets cannot be archived or modified',async()=>{
  const good={ticket_id:ticketId,reason:'Resolved ticket retained for history'};
  for(const sample of [
    {previous:'scoping',archivedAt:null,error:/Close ticket/},
    {previous:'closed',archivedAt:'2026-11-05T00:00:00Z',error:/already archived/}
  ]){
    const db=fakePool(sample);
    await assert.rejects(()=>archiveDeskTicket(db,good,'localoperator'),sample.error);
    assert.equal(db.calls.some(x=>/UPDATE arl_workbench_tickets/.test(x.sql)),false);
    assert.equal(db.calls[2].sql,'ROLLBACK');
  }
  const archived=fakePool({previous:'closed',archivedAt:'2026-11-05T00:00:00Z'});
  await assert.rejects(
    ()=>updateDeskTicketStatus(archived,{ticket_id:ticketId,status:'in_progress'}),
    /Archived ticket/
  );
  const a=fakePool({previous:'scoping',archivedAt:'2026-11-05T00:00:00Z'});
  await assert.rejects(
    ()=>assignDeskTicket(a,{ticket_id:ticketId,action:'self'},'localoperator'),
    /Archived or closed ticket/
  );
});
