import test from 'node:test';
import assert from 'node:assert/strict';
import {
  validateIntake, validateStatusChange, createDeskTicket,
  updateDeskTicketStatus, TICKET_TRANSITIONS
} from '../desktop/enkyron-ticket-intake.mjs';

const ticketId = '1111111a-2222-4333-8444-555555555555';
const call = {
  source:'phone', client_name:'Example Co', contact_name:'A. Customer',
  contact_phone:'+44 200 000 0000', contact_email:'help@example.invalid',
  title:'Request a consultation', request_text:'Customer called to discuss a security review.'
};
function fakePool({previous='new', sequence='42'}={}) {
  const calls=[];
  const db={
    query:async (sql,params)=>{
      calls.push({sql,params});
      if (sql.includes('nextval(')) return {rows:[{n:sequence}]};
      if (sql.includes('FOR UPDATE')) return {
        rows:previous===null?[]:[{status:previous,assessor_name:'localoperator'}]
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
      'BEGIN','SELECT status,assessor_name FROM arl_workbench_tickets WHERE id=$1 FOR UPDATE',
      'ROLLBACK','RELEASE'
    ]);
  }
});
