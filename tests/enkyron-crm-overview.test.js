import test from 'node:test';
import assert from 'node:assert/strict';
import {getSalesOverview} from '../desktop/enkyron-crm-overview.mjs';

const metrics={researched_prospects:344,registered_companies:0,saved_drafts:1,
  opportunities:1,active_opportunities:1,overdue:0,due_today:1,due_next_week:0,
  as_of:'2026-11-06',priority_items:[{id:'synthetic',due_date:'2026-11-06'}]};

test('overview is single read-only parameterized statement scoped to local operator',async()=>{
  const calls=[];
  const db={query:async(sql,params)=>{calls.push({sql,params});return {rows:[metrics]};}};
  const value=await getSalesOverview(db,'ci-operator');
  assert.equal(value.available,true);
  assert.equal(value.overview.due_today,1);
  assert.deepEqual(calls[0].params,['local:ci-operator']);
  assert.match(calls[0].sql,/Europe\/London/);
  assert.match(calls[0].sql,/LIMIT 6/);
  assert.match(calls[0].sql,/workspace_key=\$1/);
  assert.doesNotMatch(calls[0].sql,/\b(?:INSERT|UPDATE|DELETE|MERGE)\b/i);
  assert.equal(calls.length,1);
});
test('reject invalid actor and corrupted summary rather than inventing metrics',async()=>{
  await assert.rejects(()=>getSalesOverview({query:async()=>({rows:[metrics]})},
    'a name'),/CRM invalid/);
  for(const row of [{...metrics,due_today:-1},{...metrics,priority_items:'bad'},
    {...metrics,researched_prospects:'344'},null]){
    await assert.rejects(()=>getSalesOverview({
      query:async()=>({rows:row?[row]:[]})
    },'ci-operator'),/CRM invalid/);
  }
});
test('missing migration reports unavailable without changing records',async()=>{
  const value=await getSalesOverview({query:async()=>{
    const e=new Error('not installed');e.code='42P01';throw e;
  }},'ci-operator');
  assert.equal(value.available,false);
  assert.match(value.notice,/unavailable/);
});
