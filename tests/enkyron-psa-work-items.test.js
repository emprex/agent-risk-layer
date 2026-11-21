import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {createMissionWorkItem,completeMissionWorkItem,listMissionWorkItems}
  from '../desktop/enkyron-psa-work-items.mjs';
const mission='33333333-4444-4555-8666-777777777777';
const task='44444444-5555-4666-8777-888888888888';
const request='aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee';
const event='bbbbbbbb-cccc-4ddd-8eee-ffffffffffff';
const createInput={mission_id:mission,kind:'task',title:'Review synthetic controls',
  due_date:'2026-12-20',request_id:request,confirmed:true};
const completeInput={mission_id:mission,task_id:task,expected_version:1,
  completed:true,confirmed:true,request_id:event};
const records=[];
function db(options={}) {
  const calls=[];
  const client={async query(sql,params=[]){
    calls.push({sql,params});
    if(['BEGIN','COMMIT','ROLLBACK'].includes(sql))return {rows:[]};
    if(sql.includes('FROM enkyron_psa_work_items WHERE workspace_key=$1 AND request_id=$2'))
      return {rows:options.prior?[options.prior]:[]};
    if(sql.includes('FROM enkyron_psa_missions'))
      return {rows:options.missionMissing?[]:[{id:mission,status:'planning'}]};
    if(sql.startsWith('INSERT INTO enkyron_psa_work_items')){
      if(options.conflict)return {rows:[]};
      const row={id:task,mission_id:mission,kind:'task',status:'open',version:1,
        content_sha256:params[7]};
      records.push(row);
      return {rows:[row]};
    }
    if(sql.startsWith('INSERT INTO enkyron_psa_work_item_events')){
      if(options.auditFailure)throw new Error('Synthetic audit unavailable');
      return {rows:[]};
    }
    if(sql.includes('FROM enkyron_psa_work_item_events'))
      return {rows:options.event?[options.event]:[]};
    if(sql.includes('FROM enkyron_psa_work_items')&&sql.includes('FOR UPDATE'))
      return {rows:options.taskMissing?[]:[{id:task,mission_id:mission,
        status:options.taskStatus??'open',version:options.version??1}]};
    if(sql.startsWith('UPDATE enkyron_psa_work_items'))return {rows:[{id:task,version:(options.version??1)+1}]};
    if(sql.startsWith('SELECT id FROM enkyron_psa_missions'))return {rows:[{id:mission}]};
    if(sql.startsWith('SELECT w.id'))return {rows:options.items??[]};
    throw Error('Unexpected SQL: '+sql);
  },release(){calls.push({sql:'RELEASE',params:[]});}};
  const pool={connect:async()=>client,query:(sql,params)=>client.query(sql,params)};
  return {pool,calls};
}
const uuids=()=>{const values=[task,event];return ()=>values.shift();};

test('ENK-08: create task has explicit scoped mission, audit, and atomic commit',async()=>{
  const x=db(),out=await createMissionWorkItem(x.pool,createInput,'operator',{uuid:uuids()});
  assert.equal(out.created,true);assert.equal(out.status,'open');
  assert.deepEqual(x.calls.filter(y=>['BEGIN','COMMIT','ROLLBACK'].includes(y.sql)).map(y=>y.sql),['BEGIN','COMMIT']);
  assert.ok(x.calls.filter(y=>y.params.length).every(y=>y.params.includes('local:operator')));
  assert.equal(x.calls.filter(y=>y.sql.startsWith('INSERT INTO enkyron_psa_work_item_events')).length,1);
});

test('ENK-08: rejects missing parent, untrusted actor, and unvalidated fields',async()=>{
  const x=db({missionMissing:true});
  await assert.rejects(createMissionWorkItem(x.pool,createInput,'operator'),/mission not found/);
  assert.equal(x.calls.some(y=>y.sql.startsWith('INSERT INTO')),false);
  assert.equal(x.calls.some(y=>y.sql==='ROLLBACK'),true);
  const y=db();
  await assert.rejects(createMissionWorkItem(y.pool,createInput,'local:wrong'),/trusted local/);
  await assert.rejects(createMissionWorkItem(y.pool,{...createInput,assignee_id:mission},'operator'),/PSA invalid/);
  assert.equal(y.calls.length,0);
});

test('ENK-08: retries same task, rejects changed payload',async()=>{
  const first=db();await createMissionWorkItem(first.pool,createInput,'operator',{uuid:uuids()});
  const hash=records.at(-1).content_sha256;
  const x=db({prior:{id:task,mission_id:mission,kind:'task',status:'open',version:1,
    content_sha256:hash}});
  assert.equal((await createMissionWorkItem(x.pool,createInput,'operator')).created,false);
  await assert.rejects(createMissionWorkItem(x.pool,{...createInput,title:'Entirely different task'},'operator'),/reused/);
  assert.equal(x.calls.some(y=>y.sql.startsWith('INSERT INTO')),false);
});

test('ENK-08: completion is versioned, scoped and audited',async()=>{
  const x=db();
  const res=await completeMissionWorkItem(x.pool,completeInput,'operator',{uuid:()=>event});
  assert.deepEqual([res.status,res.changed,res.version],['completed',true,2]);
  assert.equal(x.calls.filter(y=>y.sql.startsWith('INSERT INTO enkyron_psa_work_item_events')).length,1);
  assert.ok(x.calls.some(y=>y.sql.includes('FOR UPDATE')&&y.params.includes(mission)));
  const stale=db({version:2});
  await assert.rejects(completeMissionWorkItem(stale.pool,completeInput,'operator'),/revision changed/);
  assert.equal(stale.calls.some(y=>y.sql==='ROLLBACK'),true);
});

test('ENK-08: completed retry must match original task AND mission',async()=>{
  const sha=(await import('node:crypto')).createHash('sha256')
    .update(JSON.stringify([mission,task,1,true])).digest('hex');
  const record={mission_id:mission,item_id:task,version:2,event_type:'completed',content_sha256:sha};
  const x=db({event:record});
  assert.equal((await completeMissionWorkItem(x.pool,completeInput,'operator')).changed,false);
  const fakeMission='11111111-2222-4333-8444-555555555555';
  await assert.rejects(completeMissionWorkItem(x.pool,{...completeInput,mission_id:fakeMission},'operator'),/reused/);
  assert.equal(x.calls.some(y=>y.sql.startsWith('UPDATE')),false);
});

test('ENK-08: rollback when audit fails; cannot silently complete',async()=>{
  const x=db({auditFailure:true});
  await assert.rejects(completeMissionWorkItem(x.pool,completeInput,'operator',{uuid:()=>event}),/audit unavailable/);
  assert.deepEqual(x.calls.filter(y=>['BEGIN','COMMIT','ROLLBACK'].includes(y.sql)).map(y=>y.sql),['BEGIN','ROLLBACK']);
});

test('ENK-08: reads are bounded and local-operator scoped',async()=>{
  const x=db({items:Array.from({length:101},(_,i)=>({id:i}))});
  const out=await listMissionWorkItems(x.pool,mission,'operator');
  assert.equal(out.items.length,100);assert.equal(out.more,true);
  assert.deepEqual(x.calls.filter(y=>y.params.length).map(y=>y.params),[
    ['local:operator',mission],['local:operator',mission]
  ]);
  assert.ok(x.calls.some(y=>y.sql.includes('LIMIT 101')));
});

test('ENK-08: work items DDL is review-only, scoped and append-only audit',()=>{
  const sql=fs.readFileSync(new URL('../docs/enkyron/sql/119_enkyron_psa_work_items.sql',import.meta.url),'utf8');
  assert.match(sql,/FOREIGN KEY\(workspace_key,mission_id\)/);
  assert.match(sql,/FOREIGN KEY\(workspace_key,mission_id,item_id\)/);
  assert.match(sql,/UNIQUE\(workspace_key,request_id\)/);
  assert.match(sql,/enkyron_psa_work_item_events_immutable/);
  assert.equal(fs.existsSync(new URL('../migrations/119_enkyron_psa_work_items.sql',import.meta.url)),false);
});
