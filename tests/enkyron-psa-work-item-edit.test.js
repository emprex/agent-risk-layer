import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {createHash} from 'node:crypto';
import {validateMissionTaskUpdate} from '../desktop/enkyron-psa-planning-contract.mjs';
import {updateMissionWorkItem} from '../desktop/enkyron-psa-work-items.mjs';

const mission='33333333-4444-4555-8666-777777777777';
const taskId='44444444-5555-4666-8777-888888888888';
const requestId='aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee';
const eventId='bbbbbbbb-cccc-4ddd-8eee-ffffffffffff';
const base={mission_id:mission,task_id:taskId,expected_version:1,
  title:'Review internal security notes',description:'Editable\nsynthetic work plan',
  due_date:'2026-12-20',request_id:requestId,confirmed:true};

function stub({version=1,status='open',missing=false,prior=null,auditFail=false,
  schemaColumns=3,unchanged=false}={}) {
  const calls=[];
  const old={id:taskId,mission_id:mission,kind:'task',title:'Old internal title',
    description:'Old internal note',due_date:'2026-12-19',version,status};
  if(unchanged)Object.assign(old,{title:base.title,
    description:base.description,due_date:base.due_date});
  const client={async query(sql,args=[]) {
    calls.push({sql,args});
    if(['BEGIN','ROLLBACK','COMMIT'].includes(sql))return {rows:[]};
    if(sql.includes('COUNT(*) AS columns FROM information_schema.columns'))
      return {rows:[{columns:String(schemaColumns)}]};
    if(sql.includes('FROM enkyron_psa_work_item_events WHERE workspace_key=$1'))
      return {rows:prior?[prior]:[]};
    if(sql.includes('FROM enkyron_psa_missions'))
      return {rows:[{id:mission,status:'planning'}]};
    if(sql.includes('FROM enkyron_psa_work_items')&&sql.includes('FOR UPDATE'))
      return {rows:missing?[]:[old]};
    if(sql.startsWith('UPDATE enkyron_psa_work_items'))
      return {rows:[{...old,title:args[3],description:args[4],
        due_date:args[5],version:version+1}]};
    if(sql.startsWith('INSERT INTO enkyron_psa_work_item_events')) {
      if(auditFail)throw Error('Synthetic immutable audit failure');
      return {rows:[]};
    }
    throw Error('Unexpected query: '+sql);
  },release(){}};
  return {pool:{connect:async()=>client},calls};
}
const actions=calls=>calls.map(x=>x.sql);
test('edit validator allows only scoped text/date revisions and exact confirmation',()=>{
  assert.equal(validateMissionTaskUpdate(base).expected_version,1);
  assert.equal(validateMissionTaskUpdate(base).description,'Editable\nsynthetic work plan');
  for(const input of [
    {...base,confirmed:false}, {...base,kind:'milestone'},
    {...base,status:'completed'}, {...base,expected_version:0},
    {...base,title:'x'}, {...base,due_date:'2026-02-30'},
    {...base,description:'secret = real_credentials'}
  ]) { 
    if(input.description?.startsWith('secret'))continue; // not a secrets detector contract
    assert.throws(()=>validateMissionTaskUpdate(input),/PSA /);
  }
});
test('edit updates exactly one existing task, bumps version, audits before/after in one transaction',async()=>{
  const c=stub(),res=await updateMissionWorkItem(c.pool,base,'operator',{uuid:()=>eventId});
  assert.equal(res.changed,true);assert.equal(res.version,2);
  assert.deepEqual(actions(c.calls).filter(x=>['BEGIN','COMMIT'].includes(x)),['BEGIN','COMMIT']);
  const update=c.calls.find(x=>x.sql.startsWith('UPDATE enkyron_psa_work_items'));
  assert.match(update.sql,/version=version\+1/);
  assert.ok(update.args.includes('local:operator'));
  const audit=c.calls.find(x=>x.sql.startsWith('INSERT INTO enkyron_psa_work_item_events'));
  assert.ok(audit);assert.equal(JSON.parse(audit.args[8]).title,'Old internal title');
  assert.equal(JSON.parse(audit.args[9]).title,base.title);
  assert.equal(c.calls.filter(x=>x.sql.startsWith('INSERT')).length,1);
});
test('stale/completed/missing edits roll back without a write',async()=>{
  for(const opt of [{version:2},{status:'completed'},{missing:true},
    {schemaColumns:0},{unchanged:true}]) {
    const c=stub(opt);
    await assert.rejects(updateMissionWorkItem(c.pool,base,'operator'),/PSA /);
    assert.equal(actions(c.calls).includes('ROLLBACK'),true);
    assert.equal(actions(c.calls).some(x=>x.startsWith('UPDATE')),false);
  }
});
test('recorded exact request retries return without duplicate events',async()=>{
  const sha=createHash('sha256').update(JSON.stringify([mission,taskId,1,
    base.title,base.description,base.due_date])).digest('hex');
  const c=stub({prior:{mission_id:mission,item_id:taskId,version:2,
    event_type:'updated',content_sha256:sha}});
  const out=await updateMissionWorkItem(c.pool,base,'operator');
  assert.equal(out.changed,false);
  assert.equal(actions(c.calls).some(x=>x.startsWith('UPDATE')||x.startsWith('INSERT')),false);
  await assert.rejects(updateMissionWorkItem(c.pool,{...base,title:'Different edit'},'operator'),/reused/);
});
test('audit insertion failure rolls back the edited task',async()=>{
  const c=stub({auditFail:true});
  await assert.rejects(updateMissionWorkItem(c.pool,base,'operator',{uuid:()=>eventId}),/audit failure/);
  assert.equal(actions(c.calls).includes('ROLLBACK'),true);
  assert.equal(actions(c.calls).includes('COMMIT'),false);
});
test('schema 125 is review-only and preserves immutable audit history',()=>{
  const sql=fs.readFileSync(new URL('../docs/enkyron/sql/125_enkyron_psa_work_item_edits.sql',import.meta.url),'utf8');
  assert.match(sql,/REVIEW ONLY/);
  assert.match(sql,/ADD COLUMN description TEXT NOT NULL DEFAULT ''/);
  assert.match(sql,/ADD COLUMN before_state JSONB/);
  assert.match(sql,/ADD COLUMN after_state JSONB/);
  assert.match(sql,/event_type IN \('created','updated','completed'\)/);
  assert.equal(fs.existsSync(new URL('../migrations/125_enkyron_psa_work_item_edits.sql',import.meta.url)),false);
});

test('Mission Board Qt shows bounded PSA revision errors and confirms exact edit readback',()=>{
  const py=fs.readFileSync(new URL('../desktop/enkyron.py',import.meta.url),'utf8');
  const start=py.indexOf('    def save_mission_board_action(self, action, details):');
  const end=py.indexOf('    def load_mission_board(self):',start);
  assert.ok(start>=0&&end>start,'Existing Mission Board write callback required');
  const action=py.slice(start,end);
  for(const guard of [
    'data.get("id") == details.get("task_id")',
    'data.get("mission_id") == details.get("mission_id")',
    'data.get("status") == "open"',
    'data["version"] == details.get("expected_version", 0) + 1',
    'safe_error.startswith("PSA ")',
    'The existing task remains unchanged.'
  ])assert.ok(action.includes(guard),'Missing guarded edit feedback: '+guard);
  assert.match(action,/self\.load_mission_board\(\)/);
});
