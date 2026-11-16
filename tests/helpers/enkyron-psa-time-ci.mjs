// Run ONLY inside existing guarded pg_virtualenv ENK-08 integration test.
// No connections, credentials, schema lifecycle or production writes here.
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {createMissionTimeEntry, listMissionTimeEntries}
  from '../../desktop/enkyron-psa-time.mjs';
import {createMissionWorkItem} from '../../desktop/enkyron-psa-work-items.mjs';
const uuid = () => randomUUID();
function payload(mission, minutes, workItem = null, requestId = uuid()) {
  return {mission_id: mission, work_item_id: workItem,
    work_date: '2026-11-16', minutes,
    note: 'Synthetic internal planning time only',
    request_id: requestId, confirmed: true};
}
export async function exerciseTimeEntries(pool, missionId, otherMissionId, actor, outsider) {
  const workspace = 'local:' + actor;
  const workItem = (await pool.query(
    'SELECT id FROM enkyron_psa_work_items WHERE workspace_key=$1 '
    + 'AND mission_id=$2 ORDER BY id LIMIT 1',
    [workspace, missionId]
  )).rows[0].id;
  const other = await createMissionWorkItem(pool, {
    mission_id: otherMissionId, kind: 'task', title: 'Other mission plan task',
    due_date: '2026-12-28', request_id: uuid(), confirmed: true,
  }, actor);
  const input = payload(missionId, 90, workItem);
  const first = await createMissionTimeEntry(pool, input, actor);
  assert.deepEqual([first.status, first.billing_state, first.minutes, first.created],
    ['draft', 'not_billable', 90, true]);
  assert.equal((await createMissionTimeEntry(pool, input, actor)).created, false);
  await assert.rejects(createMissionTimeEntry(pool, {...input, minutes: 100}, actor), /reused/);
  const independent = await createMissionTimeEntry(pool, payload(missionId, 165), actor);
  assert.equal(independent.created, true);
  await assert.rejects(createMissionTimeEntry(pool,
    payload(missionId, 20, other.id), actor), /not linked/);
  await assert.rejects(createMissionTimeEntry(pool, payload(missionId, 20), outsider), /not found/);
  await assert.rejects(listMissionTimeEntries(pool, missionId, outsider), /not found/);

  const requestId = uuid();
  const concurrent = await Promise.all(Array.from({length: 6}, () =>
    createMissionTimeEntry(pool, payload(missionId, 30, null, requestId), actor)
  ));
  assert.equal(concurrent.filter(e => e.created).length, 1);
  assert.equal(new Set(concurrent.map(e => e.id)).size, 1);
  const eventCount = (await pool.query(
    'SELECT count(*)::int AS count FROM enkyron_psa_time_events '
    + 'WHERE workspace_key=$1 AND request_id=$2',
    [workspace, requestId]
  )).rows[0].count;
  assert.equal(eventCount, 1);

  const listed = await listMissionTimeEntries(pool, missionId, actor);
  assert.equal(listed.items.length, 3);
  assert.equal(listed.entries, 3);
  assert.equal(listed.total_minutes, 285);
  assert.deepEqual([listed.approved, listed.billable, listed.more], [false, false, false]);
  assert.ok(listed.items.every(e => e.status === 'draft' && e.billing_state === 'not_billable'));
  assert.equal((await listMissionTimeEntries(pool, otherMissionId, actor)).items.length, 0);

  await assert.rejects(pool.query(
    'UPDATE enkyron_psa_time_entries SET minutes=120 WHERE id=$1', [first.id]
  ), /cannot be changed or deleted/);
  await assert.rejects(pool.query(
    'DELETE FROM enkyron_psa_time_entries WHERE id=$1', [first.id]
  ), /cannot be changed or deleted/);
  await assert.rejects(pool.query(
    'UPDATE enkyron_psa_time_events SET actor_local=$1 WHERE time_entry_id=$2',
    ['changed', first.id]
  ), /cannot be changed or deleted/);
  await assert.rejects(pool.query(
    'DELETE FROM enkyron_psa_time_events WHERE time_entry_id=$1', [first.id]
  ), /cannot be changed or deleted/);

  // Direct SQL bypass attempts must also fail at the database boundary.
  const direct = (id, itemId, minutes, billingState, scope = workspace) =>
    pool.query(
      'INSERT INTO enkyron_psa_time_entries '
      + '(id,workspace_key,mission_id,work_item_id,work_date,minutes,note,'
      + 'request_id,content_sha256,created_by,billing_state) '
      + 'VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)',
      [id, scope, missionId, itemId, '2026-11-16', minutes,
        'Synthetic direct SQL rejection check', uuid(), 'f'.repeat(64),
        actor, billingState]
    );
  await assert.rejects(direct(uuid(), null, 90, 'approved'), e => e.code === '23514');
  await assert.rejects(direct(uuid(), null, 721, 'not_billable'), e => e.code === '23514');
  await assert.rejects(direct(uuid(), other.id, 90, 'not_billable'), e => e.code === '23503');
  await assert.rejects(direct(uuid(), workItem, 90, 'not_billable',
    'local:' + outsider), e => e.code === '23503');

  const usedEventId = (await pool.query(
    'SELECT id FROM enkyron_psa_time_events WHERE time_entry_id=$1', [first.id]
  )).rows[0].id;
  const failedRequest = uuid(), generated = [uuid(), usedEventId];
  await assert.rejects(createMissionTimeEntry(pool,
    payload(missionId, 15, null, failedRequest), actor,
    {uuid: () => generated.shift()}), e => e.code === '23505');
  assert.equal((await pool.query(
    'SELECT count(*)::int AS count FROM enkyron_psa_time_entries WHERE request_id=$1',
    [failedRequest]
  )).rows[0].count, 0);
  const summary = (await pool.query(
    'SELECT (SELECT count(*) FROM enkyron_psa_time_entries)::int AS entries,'
    + '(SELECT count(*) FROM enkyron_psa_time_events)::int AS events'
  )).rows[0];
  assert.deepEqual(summary, {entries: 3, events: 3});
}
