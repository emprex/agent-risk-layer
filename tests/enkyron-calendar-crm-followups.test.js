import test from 'node:test';
import assert from 'node:assert/strict';
import {calendarList} from '../desktop/enkyron-calendar.mjs';

const scope='local:synthetic-operator';
const interval={
  start:'2026-11-01T00:00:00Z',
  end:'2026-12-01T00:00:00Z',
};
const company='11111111-2222-4333-8444-555555555555';
const followup='aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee';

test('calendar lists canonical company follow-ups by London date without new tasks',async()=>{
  const calls=[];
  const pool={query:async(sql,params)=>{
    calls.push({sql,params});
    if(sql.includes('FROM enkyron_calendar_events'))return {rows:[]};
    if(sql.includes('FROM enkyron_calendar_tasks'))return {rows:[]};
    if(sql.includes('FROM enkyron_crm_company_followups'))return {
      rows:[{id:followup,company_id:company,company_name:'Synthetic Co',
        action_text:'Check for a response',due_date:'2026-11-28',
        status:'open',version:1}]
    };
    throw Error('Unexpected query');
  }};
  const result=await calendarList(pool,'synthetic-operator',interval);
  assert.deepEqual(result.events,[]);
  assert.deepEqual(result.tasks,[]);
  assert.equal(result.company_followups.length,1);
  assert.equal(result.company_followups[0].id,followup);
  assert.equal(result.company_followups[0].due_date,'2026-11-28');
  assert.equal(result.company_followups_available,true);
  assert.equal(result.company_followups_more,false);
  assert.equal(calls.length,3);
  assert.ok(calls.every(x=>/^\s*SELECT/i.test(x.sql)));
  assert.ok(calls.every(x=>x.params[0]===scope));
  assert.ok(calls.every(x=>x.params[1]===interval.start &&
                          x.params[2]===interval.end));
  const sql=calls[2].sql;
  assert.match(sql,/JOIN enkyron_crm_companies/);
  assert.match(sql,/c\.workspace_key=f\.workspace_key/);
  assert.match(sql,/f\.workspace_key=\$1/);
  assert.match(sql,/f\.status='open'/);
  assert.match(sql,/Europe\/London/);
  assert.doesNotMatch(sql,/\bINSERT\b|\bUPDATE\b|\bDELETE\b/i);
});

test('calendar stays usable without CRM schema 105 and never invents reminders',async()=>{
  const calls=[];
  const pool={query:async(sql,params)=>{
    calls.push(sql);
    if(sql.includes('enkyron_calendar_events'))return {rows:[{id:'event'}]};
    if(sql.includes('enkyron_calendar_tasks'))return {rows:[{id:'task'}]};
    if(sql.includes('enkyron_crm_company_followups'))throw Object.assign(
      Error('Missing table'),{code:'42P01'});
    throw Error('unexpected');
  }};
  const result=await calendarList(pool,'synthetic-operator',interval);
  assert.equal(result.company_followups_available,false);
  assert.deepEqual(result.company_followups,[]);
  assert.deepEqual(result.events,[{id:'event'}]);
  assert.deepEqual(result.tasks,[{id:'task'}]);
  assert.equal(calls.length,3);
});

test('invalid calendar range does not query CRM or create anything',async()=>{
  let queries=0;
  const pool={query:()=>{queries++;throw Error('Should not run');}};
  await assert.rejects(calendarList(pool,'synthetic-operator',{
    start:interval.end,end:interval.start
  }),/interval/);
  assert.equal(queries,0);
});
