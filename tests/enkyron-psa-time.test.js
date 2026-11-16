import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {createMissionTimeEntry, listMissionTimeEntries}
  from '../desktop/enkyron-psa-time.mjs';
import {validateMissionTimeEntryCreate}
  from '../desktop/enkyron-psa-planning-contract.mjs';

const mission = '33333333-4444-4555-8666-777777777777';
const item = '44444444-5555-4666-8777-888888888888';
const timeId = '55555555-6666-4777-8888-999999999999';
const eventId = '66666666-7777-4888-9999-aaaaaaaaaaaa';
const requestId = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee';
const original = {
  mission_id: mission, work_item_id: item, work_date: '2026-11-15',
  minutes: 90, note: 'Prepare internal assessment scope',
  request_id: requestId, confirmed: true,
};

function db(options = {}) {
  const calls = [];
  let hash;
  let priorReads = 0;
  const client = {
    async query(sql, params = []) {
      calls.push({sql, params});
      if (['BEGIN', 'COMMIT', 'ROLLBACK'].includes(sql)) return {rows: []};
      if (sql.includes('FROM enkyron_psa_time_entries') && sql.includes('request_id=$2')) {
        priorReads++;
        return {rows: [priorReads === 1 ? options.previous : options.winner].filter(Boolean)};
      }
      if (sql.includes('FROM enkyron_psa_missions')) {
        return {rows: options.missionMissing ? [] : [{id: mission, status: 'planning'}]};
      }
      if (sql.includes('FROM enkyron_psa_work_items')) {
        return {rows: options.itemMissing ? [] : [{id: item}]};
      }
      if (sql.startsWith('INSERT INTO enkyron_psa_time_entries')) {
        hash = params[8];
        return {rows: options.conflict ? [] : [{
          id: timeId, mission_id: mission, work_item_id: item,
          work_date: original.work_date, minutes: original.minutes,
          status: 'draft', billing_state: 'not_billable', content_sha256: hash,
        }]};
      }
      if (sql.startsWith('INSERT INTO enkyron_psa_time_events')) {
        if (options.auditFailure) throw new Error('Synthetic time audit failure');
        return {rows: []};
      }
      if (sql.startsWith('SELECT id,mission_id,work_item_id,work_date::text')) {
        return {rows: options.items ?? []};
      }
      if (sql.startsWith('SELECT count(*)::int AS entries')) {
        return {rows: [{entries: options.entries ?? 0, minutes: options.minutes ?? '0'}]};
      }
      throw new Error('Unexpected query: ' + sql);
    },
    release() { calls.push({sql: 'RELEASE', params: []}); },
  };
  return {calls, pool: {connect: async () => client, query: (sql, params) =>
    client.query(sql, params)}, get hash() {return hash;}};
}
const ids = () => {
  const values = [timeId, eventId];
  return () => values.shift();
};

test('ENK-08 time: manual drafts always nonbillable and require human confirmation', () => {
  assert.deepEqual(
    {status: validateMissionTimeEntryCreate(original).status,
      billing: validateMissionTimeEntryCreate(original).billing_state},
    {status: 'draft', billing: 'not_billable'}
  );
  for (const invalid of [
    {...original, minutes: 0}, {...original, minutes: 721},
    {...original, minutes: 2.5}, {...original, minutes: true},
    {...original, note: 'short'}, {...original, note: 'Invisible\u200btext in note'},
    {...original, work_date: '2026-02-30'}, {...original, work_date: null},
    {...original, confirmed: false}, {...original, approved: true},
    {...original, billable: true}, {...original, actor: 'other'},
    {...original, work_item_id: 'wrong'},
  ]) assert.throws(() => validateMissionTimeEntryCreate(invalid), /PSA/);
});

test('ENK-08 time: write is scoped, atomic, event-audited and immutable by design', async () => {
  const x = db(), value = await createMissionTimeEntry(x.pool, original, 'operator', {uuid: ids()});
  assert.deepEqual({status: value.status, billing_state: value.billing_state,
    created: value.created, minutes: value.minutes},
  {status: 'draft', billing_state: 'not_billable', created: true, minutes: 90});
  assert.deepEqual(x.calls.filter(c => ['BEGIN','COMMIT','ROLLBACK'].includes(c.sql)).map(c => c.sql),
    ['BEGIN','COMMIT']);
  assert.ok(x.calls.filter(c => c.params.length).every(c => c.params.includes('local:operator')));
  assert.equal(x.calls.filter(c => c.sql.startsWith('INSERT INTO enkyron_psa_time_events')).length, 1);
});

test('ENK-08 time: rejects missing/mismatched scoped mission and work item before insert', async () => {
  for (const conditions of [{missionMissing: true}, {itemMissing: true}]) {
    const x = db(conditions);
    await assert.rejects(createMissionTimeEntry(x.pool, original, 'operator'), /PSA/);
    assert.equal(x.calls.some(c => c.sql.startsWith('INSERT INTO')), false);
    assert.ok(x.calls.some(c => c.sql === 'ROLLBACK'));
  }
});

test('ENK-08 time: idempotent retry and changed content use separate outcomes', async () => {
  const first = db();
  await createMissionTimeEntry(first.pool, original, 'operator', {uuid: ids()});
  const row = {
    id: timeId, mission_id: mission, work_item_id: item,
    work_date: original.work_date, minutes: original.minutes,
    status: 'draft', billing_state: 'not_billable', content_sha256: first.hash,
  };
  const retry = db({previous: row});
  assert.equal((await createMissionTimeEntry(retry.pool, original, 'operator')).created, false);
  await assert.rejects(createMissionTimeEntry(retry.pool,
    {...original, minutes: 120}, 'operator'), /reused/);
  assert.equal(retry.calls.some(c => c.sql.startsWith('INSERT INTO')), false);
  const race = db({conflict: true, winner: row});
  assert.equal((await createMissionTimeEntry(race.pool, original, 'operator')).created, false);
  assert.equal(race.calls.some(c => c.sql.startsWith('INSERT INTO enkyron_psa_time_events')), false);
});

test('ENK-08 time: failed audit rolls back time entry insert', async () => {
  const x = db({auditFailure: true});
  await assert.rejects(
    createMissionTimeEntry(x.pool, original, 'operator', {uuid: ids()}), /time audit failure/
  );
  assert.deepEqual(x.calls.filter(c => ['BEGIN','COMMIT','ROLLBACK'].includes(c.sql)).map(c => c.sql),
    ['BEGIN','ROLLBACK']);
});

test('ENK-08 time: bounded read and full count/total stay workspace-scoped', async () => {
  const x = db({items: Array.from({length: 51}, (_, i) => ({id: i})),
    entries: 82, minutes: '4500'});
  const value = await listMissionTimeEntries(x.pool, mission, 'operator');
  assert.deepEqual({shown: value.items.length, more: value.more, entries: value.entries,
    total_minutes: value.total_minutes, billable: value.billable},
    {shown: 50, more: true, entries: 82, total_minutes: 4500, billable: false});
  assert.ok(x.calls.filter(c => c.params.length).every(c =>
    c.params[0] === 'local:operator' && c.params[1] === mission));
  const foreign = db({missionMissing: true});
  await assert.rejects(listMissionTimeEntries(foreign.pool, mission, 'other'), /PSA/);
});

test('ENK-08 time: draft schema cannot be auto-discovered as a production migration', () => {
  const path = new URL('../docs/enkyron/sql/120_enkyron_psa_time_entries.sql', import.meta.url);
  const sql = fs.readFileSync(path, 'utf8');
  assert.match(sql, /FOREIGN KEY\(workspace_key,mission_id\)/);
  assert.match(sql, /FOREIGN KEY\(workspace_key,mission_id,work_item_id\)/);
  assert.match(sql, /enkyron_psa_time_entries_immutable/);
  assert.match(sql, /enkyron_psa_time_events_immutable/);
  assert.match(sql, /CHECK\(billing_state='not_billable'\)/);
  assert.ok(!fs.existsSync(new URL('../migrations/120_enkyron_psa_time_entries.sql',
    import.meta.url)));
});
