import test from 'node:test';
import assert from 'node:assert/strict';
import {
  validateCompanyFollowupCreate,validateCompanyFollowupUpdate,
  listUpcomingCompanyFollowups,listCompanyFollowups
} from '../desktop/enkyron-crm-company-followups.mjs';
const id='11111111-2222-4333-8444-555555555555';
const uuid='aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee';
const create={company_id:id,action_text:'Review if the introduction received a response',
  due_date:'2026-11-17',confirmed:true};
test('company tasks do not require opportunities or outside communications',()=>{
  assert.deepEqual(validateCompanyFollowupCreate(create),{
    company_id:id,action_text:create.action_text,due_date:'2026-11-17'
  });
  assert.deepEqual(validateCompanyFollowupUpdate({
    id:uuid,expected_version:1,status:'completed',action_text:create.action_text,
    due_date:create.due_date,confirmed:true
  }),{
    id:uuid,expected_version:1,status:'completed',action_text:create.action_text,
    due_date:create.due_date
  });
  for(const bad of [
    {...create,company_id:undefined},
    {...create,confirmed:false},
    {...create,action_text:'no'},
    {...create,due_date:'2026-02-30'},
    {...create,due_date:'2026-13-01'},
    {...create,due_date:'2026-11-17T01:02:00Z'}
  ]) assert.throws(()=>validateCompanyFollowupCreate(bad),/CRM/);
  for(const bad of [
    {id:uuid,expected_version:0,status:'open'},
    {id:uuid,expected_version:1,status:'sent'},
    {id:'bad',expected_version:1,status:'open'}
  ]) assert.throws(()=>validateCompanyFollowupUpdate({
    ...create,...bad
  }),/CRM/);
});
test('scoped company and global upcoming SQL return no private notes or cross-workspace joins',async()=>{
  const calls=[];
  const db={query:async(sql,params)=>{
    calls.push({sql,params});
    if(sql.startsWith('SELECT id FROM enkyron_crm_companies'))
      return {rows:[{id}]};
    return {rows:[]};
  }};
  const a=await listCompanyFollowups(db,id,'operator');
  const b=await listUpcomingCompanyFollowups(db,'operator');
  assert.equal(a.available,true);
  assert.equal(b.available,true);
  assert.equal(calls.length,3);
  assert.deepEqual(calls[0].params,['local:operator',id]);
  assert.deepEqual(calls[1].params,['local:operator',id]);
  assert.deepEqual(calls[2].params,['local:operator']);
  assert.match(calls[2].sql,/c[.]workspace_key=f[.]workspace_key/);
  assert.match(calls[2].sql,/f[.]status='open'/);
  assert.match(calls[2].sql,/ORDER BY f[.]due_date/);
  assert.doesNotMatch(calls[2].sql,/enkyron_crm_opportunities/);
  assert.doesNotMatch(calls[2].sql,/body_text|detail|email|marketing_permission/);
});
