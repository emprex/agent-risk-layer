import test from 'node:test';
import assert from 'node:assert/strict';
import {calendarCreateTask,calendarList} from '../desktop/enkyron-calendar.mjs';

function fixture(){
  const statements=[];
  const query=async (sql, params=[])=>{
    statements.push({sql,params});
    if(sql.startsWith('SELECT task_id'))return {rows:[{
      id:'11111111-2222-4333-8444-555555555555',
      title:'Review real outreach replies',
      due_at:'2026-11-18T17:00:00.000Z',
      completed_at:null,crm_company_id:null,
      notes:'Check inbound replies before preparing any follow-up.'
    }]};
    if(sql.startsWith('SELECT event_id'))return {rows:[]};
    return {rows:[],rowCount:1};
  };
  return {statements,pool:{query,connect:async()=>({query,release(){}})}};
}

test('new task saves optional notes in the same transaction; no mail sent',async()=>{
  const f=fixture();
  const result=await calendarCreateTask(f.pool,'operator',{
    title:'Review real outreach replies',due_at:'2026-11-18T17:00:00Z',
    notes:'Check inbound replies before preparing any follow-up.'
  });
  assert.equal(result.notes,'Check inbound replies before preparing any follow-up.');
  const insert=f.statements.find(x=>x.sql.startsWith('INSERT INTO enkyron_calendar_tasks'));
  assert.match(insert.sql,/due_at,notes/);
  assert.equal(insert.params[4],result.notes);
  assert.equal(f.statements[0].sql,'BEGIN');
  assert.equal(f.statements.at(-1).sql,'COMMIT');
  assert.ok(f.statements.some(x=>x.sql.includes("'task_created'")));
  assert.ok(!f.statements.some(x=>/resend|send_attempt|email_send|http/i.test(x.sql)));
});

test('old task clients can omit notes; invalid notes fail before transaction',async()=>{
  const f=fixture();
  const old=await calendarCreateTask(f.pool,'operator',{title:'Review replies'});
  assert.equal(old.notes,'');
  const prior=f.statements.length;
  for(const invalid of [42,'x'.repeat(4001),'bad\u0000note']){
    await assert.rejects(calendarCreateTask(f.pool,'operator',{
      title:'Review replies',notes:invalid
    }),/Invalid calendar task notes/);
  }
  assert.equal(f.statements.length,prior);
});

test('calendar returns task notes through existing scoped task list',async()=>{
  const f=fixture();
  const result=await calendarList(f.pool,'operator',{
    start:'2026-11-01T00:00:00Z',end:'2026-12-01T00:00:00Z'
  });
  assert.equal(result.tasks.length,1);
  assert.match(result.tasks[0].notes,/Check inbound replies/);
  const read=f.statements.find(x=>x.sql.startsWith('SELECT task_id'));
  assert.match(read.sql,/crm_company_id,notes/);
  assert.deepEqual(read.params[0],'local:operator');
});

test('My Work second-resolution London-offset window is accepted by Calendar',async()=>{
  const f=fixture();
  await calendarList(f.pool,'operator',{
    start:'2026-10-22T19:18:00+00:00',
    end:'2027-01-20T19:18:00+00:00'
  });
  assert.equal(f.statements.filter(x=>x.sql.startsWith('SELECT ')).length,2);
});
