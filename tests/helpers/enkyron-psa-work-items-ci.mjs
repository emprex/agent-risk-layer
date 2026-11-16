// Invoked ONLY by the guarded existing ENK-08 pg_virtualenv integration test.
// This module makes no connections and owns no cleanup or production permissions.
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {createMissionWorkItem,completeMissionWorkItem,listMissionWorkItems}
  from '../../desktop/enkyron-psa-work-items.mjs';
const uuid=()=>randomUUID();
const taskInput=(mission,kind='task',requestId=uuid())=>({
  mission_id:mission,kind,title:kind==='task'?'Review synthetic security controls':'Synthetic report milestone',
  due_date:'2026-12-22',request_id:requestId,confirmed:true,
});
export async function exerciseWorkItems(pool,mission,actor,outsider) {
  const a=taskInput(mission);
  const first=await createMissionWorkItem(pool,a,actor);
  assert.deepEqual([first.status,first.version,first.created],['open',1,true]);
  const milestone=await createMissionWorkItem(pool,taskInput(mission,'milestone'),actor);
  assert.equal(milestone.kind,'milestone');
  assert.equal((await listMissionWorkItems(pool,mission,actor)).items.length,2);
  await assert.rejects(listMissionWorkItems(pool,mission,outsider),/not found/);
  await assert.rejects(createMissionWorkItem(pool,taskInput(mission),outsider),/not found/);
  assert.equal((await createMissionWorkItem(pool,a,actor)).created,false);
  await assert.rejects(createMissionWorkItem(pool,{...a,title:'Different synthetic title'},actor),/reused/);
  const concurrentRequest=uuid();
  const concurrent=await Promise.all(Array.from({length:6},()=>
    createMissionWorkItem(pool,taskInput(mission,'task',concurrentRequest),actor)));
  assert.equal(concurrent.filter(x=>x.created).length,1);
  assert.equal(new Set(concurrent.map(x=>x.id)).size,1);
  const createdEvents=(await pool.query(
    'SELECT count(*)::int AS count FROM enkyron_psa_work_item_events '
    +"WHERE workspace_key=$1 AND request_id=$2 AND event_type='created'",
    ['local:'+actor,concurrentRequest]
  )).rows[0].count;
  assert.equal(createdEvents,1);
  const completion={mission_id:mission,task_id:first.id,
    expected_version:1,completed:true,request_id:uuid(),confirmed:true};
  const done=await Promise.all(Array.from({length:5},()=>
    completeMissionWorkItem(pool,completion,actor)));
  assert.equal(done.filter(x=>x.changed).length,1);
  assert.equal(done.filter(x=>!x.changed).length,4);
  assert.equal((await completeMissionWorkItem(pool,completion,actor)).changed,false);
  await assert.rejects(completeMissionWorkItem(pool,
    {...completion,request_id:uuid()},actor),/already closed/);
  await assert.rejects(completeMissionWorkItem(pool,
    {...completion,mission_id:milestone.id},actor),/PSA/);
  await assert.rejects(completeMissionWorkItem(pool,
    {...completion,task_id:milestone.id},actor),/reused/);
  const completedEvents=(await pool.query(
    'SELECT count(*)::int AS count FROM enkyron_psa_work_item_events '
    +"WHERE workspace_key=$1 AND item_id=$2 AND event_type='completed'",
    ['local:'+actor,first.id]
  )).rows[0].count;
  assert.equal(completedEvents,1);
  const items=(await listMissionWorkItems(pool,mission,actor)).items;
  assert.deepEqual(items.map(x=>x.status),['open','open','completed']);
  await assert.rejects(pool.query(
    'UPDATE enkyron_psa_work_item_events SET actor_local=$1 WHERE item_id=$2',
    ['changed',first.id]),/cannot be changed or deleted/);
  await assert.rejects(pool.query('DELETE FROM enkyron_psa_work_item_events WHERE item_id=$1',
    [first.id]),/cannot be changed or deleted/);
  await assert.rejects(pool.query(
    'UPDATE enkyron_psa_work_items SET status=$1 WHERE id=$2',
    ['active',milestone.id]),err=>err.code==='23514');
  await assert.rejects(pool.query(
    'INSERT INTO enkyron_psa_work_items '
    +'(id,workspace_key,mission_id,kind,title,request_id,content_sha256,created_by) '
    +'VALUES($1,$2,$3,$4,$5,$6,$7,$8)',
    [uuid(),'local:'+outsider,mission,'task','Cross workspace impossible',uuid(),'f'.repeat(64),outsider]
  ),err=>err.code==='23503');
  const existingEvent=(await pool.query(
    'SELECT id FROM enkyron_psa_work_item_events WHERE item_id=$1 AND version=1',
    [first.id])).rows[0].id;
  const failedRequest=uuid(), ids=[uuid(),existingEvent];
  await assert.rejects(createMissionWorkItem(pool,taskInput(mission,'task',failedRequest),actor,
    {uuid:()=>ids.shift()}),err=>err.code==='23505');
  assert.equal((await pool.query(
    'SELECT count(*)::int AS count FROM enkyron_psa_work_items WHERE request_id=$1',
    [failedRequest])).rows[0].count,0);
  const summary=(await pool.query(
    'SELECT (SELECT count(*) FROM enkyron_psa_work_items)::int AS items,'
    +'(SELECT count(*) FROM enkyron_psa_work_item_events)::int AS events'
  )).rows[0];
  assert.deepEqual(summary,{items:3,events:4});
}
