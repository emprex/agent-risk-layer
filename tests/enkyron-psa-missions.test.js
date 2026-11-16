import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {createMissionPlan, listMissionPlans} from '../desktop/enkyron-psa-missions.mjs';

const company = '11111111-2222-4333-8444-555555555555';
const otherCompany = '55555555-2222-4333-8444-555555555555';
const opportunity = '22222222-3333-4444-8555-666666666666';
const request = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee';
const mission = '33333333-4444-4555-8666-777777777777';
const event = '44444444-5555-4666-8777-888888888888';
const input = {
  company_id: company, opportunity_id: opportunity,
  title: 'Synthetic security assessment',
  description: 'Prepare an internal assessment plan for later independent approval.',
  due_date: '2026-12-18', request_id: request, confirmed: true,
};
const sha = 'f'.repeat(64);
const existing = {id: mission, company_id: company, opportunity_id: opportunity,
  content_sha256: sha, status: 'planning', version: 1};

// No connection to arl_local is possible: all SQL responses are scripted.
function fakeDb({existingRow = null, companyRow = {id: company},
  opportunityRow = {company_id: company}, insertedRow, winnerRow = null,
  failEvent = false} = {}) {
  const calls = [];
  let generatedDigest;
  const client = {
    async query(sql, args = []) {
      calls.push({sql, args});
      if (sql.startsWith('BEGIN') || sql === 'COMMIT' || sql === 'ROLLBACK') return {rows: []};
      if (sql.includes('FROM enkyron_psa_missions WHERE workspace_key=$1 AND request_id=$2')) {
        const priorCount = calls.filter(c => c.sql.includes('FROM enkyron_psa_missions WHERE workspace_key=$1 AND request_id=$2')).length;
        return {rows: [priorCount === 1 ? existingRow : winnerRow].filter(Boolean)};
      }
      if (sql.includes('FROM enkyron_crm_companies')) return {rows: companyRow ? [companyRow] : []};
      if (sql.includes('FROM enkyron_crm_opportunities')) return {rows: opportunityRow ? [opportunityRow] : []};
      if (sql.startsWith('INSERT INTO enkyron_psa_missions')) {
        generatedDigest = args[8];
        return {rows: insertedRow === null ? [] : [{
          id: mission, company_id: company, opportunity_id: opportunity,
          content_sha256: generatedDigest, status: 'planning', version: 1,
        }]};
      }
      if (sql.startsWith('INSERT INTO enkyron_psa_mission_events')) {
        if (failEvent) throw new Error('synthetic audit insert failure');
        return {rows: []};
      }
      throw new Error('Unexpected SQL: ' + sql);
    },
    release() { calls.push({sql: 'RELEASE'}); },
  };
  return {calls, pool: {connect: async () => client}, get digest() {return generatedDigest;}};
}

function generateIds() {
  const ids = [mission, event];
  return () => ids.shift();
}

test('ENK-08: creates planning-only mission and append-only audit in one transaction', async () => {
  const db = fakeDb();
  const result = await createMissionPlan(db.pool, input, 'operator', {uuid: generateIds()});
  assert.deepEqual({id: result.id, created: result.created, status: result.status, version: result.version},
    {id: mission, created: true, status: 'planning', version: 1});
  assert.deepEqual(db.calls.filter(x => ['BEGIN', 'COMMIT', 'ROLLBACK'].includes(x.sql)).map(x => x.sql),
    ['BEGIN', 'COMMIT']);
  const queries = db.calls.filter(x => x.args?.length);
  assert.ok(queries.every(x => x.args.includes('local:operator')));
  assert.equal(queries.find(x => x.sql.startsWith('INSERT INTO enkyron_psa_missions')).args[1], 'local:operator');
  assert.equal(queries.find(x => x.sql.startsWith('INSERT INTO enkyron_psa_mission_events')).args[5], 'operator');
  assert.ok(db.calls.some(x => x.sql.includes('ON CONFLICT (workspace_key,request_id) DO NOTHING')));
  assert.equal(db.calls.at(-1).sql, 'RELEASE');
});

test('ENK-08: cross-workspace company or mismatching opportunity rolls back before writing', async () => {
  for (const options of [
    {companyRow: null}, {opportunityRow: null},
    {opportunityRow: {company_id: otherCompany}},
  ]) {
    const db = fakeDb(options);
    await assert.rejects(createMissionPlan(db.pool, input, 'operator', {uuid: generateIds()}), /PSA/);
    assert.deepEqual(db.calls.filter(x => ['BEGIN','COMMIT','ROLLBACK'].includes(x.sql)).map(x=>x.sql), ['BEGIN','ROLLBACK']);
    assert.ok(!db.calls.some(x => x.sql.startsWith('INSERT INTO')));
  }
});

test('ENK-08: rejects an untrusted operator before contacting a database', async () => {
  const db = fakeDb();
  await assert.rejects(createMissionPlan(db.pool, input, 'local:another', {uuid: generateIds()}), /trusted local operator/);
  await assert.rejects(createMissionPlan(db.pool, {...input, status: 'active'}, 'operator'), /PSA/);
  assert.equal(db.calls.length, 0);
});

test('ENK-08: already committed retry is returned unchanged; never writes a second audit', async () => {
  // The digest for an identical request is captured by a one-time create.
  const first = fakeDb();
  await createMissionPlan(first.pool, input, 'operator', {uuid: generateIds()});
  const row = {...existing, content_sha256: first.digest};
  const db = fakeDb({existingRow: row});
  const result = await createMissionPlan(db.pool, input, 'operator', {uuid: generateIds()});
  assert.equal(result.created, false);
  assert.equal(result.id, mission);
  assert.ok(!db.calls.some(x => x.sql.startsWith('INSERT INTO')));
});

test('ENK-08: reused idempotency key with changed payload is denied', async () => {
  const first = fakeDb();
  await createMissionPlan(first.pool, input, 'operator', {uuid: generateIds()});
  const db = fakeDb({existingRow: {...existing, content_sha256: first.digest}});
  await assert.rejects(createMissionPlan(db.pool, {...input, title: 'Different planning title'}, 'operator'), /reused/);
  assert.ok(db.calls.some(x => x.sql === 'ROLLBACK'));
  assert.ok(!db.calls.some(x => x.sql.startsWith('INSERT INTO')));
});

test('ENK-08: a concurrent identical request cannot insert a second event', async () => {
  const first = fakeDb();
  await createMissionPlan(first.pool, input, 'operator', {uuid: generateIds()});
  const db = fakeDb({insertedRow: null, winnerRow: {...existing, content_sha256: first.digest}});
  const result = await createMissionPlan(db.pool, input, 'operator', {uuid: generateIds()});
  assert.equal(result.created, false);
  assert.equal(db.calls.filter(x => x.sql.startsWith('INSERT INTO enkyron_psa_mission_events')).length, 0);
  assert.equal(db.calls.filter(x => x.sql.startsWith('INSERT INTO enkyron_psa_missions')).length, 1);
});

test('ENK-08: failed audit write rolls back the entire creation', async () => {
  const db = fakeDb({failEvent: true});
  await assert.rejects(createMissionPlan(db.pool, input, 'operator', {uuid: generateIds()}), /synthetic audit insert failure/);
  assert.deepEqual(db.calls.filter(x => ['BEGIN', 'COMMIT', 'ROLLBACK'].includes(x.sql)).map(x=>x.sql), ['BEGIN','ROLLBACK']);
});

test('ENK-08: list SQL is workspace-scoped and bounded', async () => {
  const calls = [];
  const pool = {query: async (sql, args) => {calls.push({sql,args});return {rows: Array.from({length:51},(_,i)=>({id:i}))};}};
  const result = await listMissionPlans(pool, 'operator', company);
  assert.equal(result.items.length, 50);
  assert.equal(result.more, true);
  assert.deepEqual(calls[0].args, ['local:operator', company]);
  assert.match(calls[0].sql, /WHERE m\.workspace_key=\$1/);
  assert.match(calls[0].sql, /c\.workspace_key=m\.workspace_key AND c\.id=m\.company_id/);
  assert.match(calls[0].sql, /LIMIT 51/);
  await assert.rejects(listMissionPlans(pool, 'operator', 'not-uuid'), /PSA/);
});

test('ENK-08: migration declares matching composite FKs and immutable event history', () => {
  const sql = fs.readFileSync(new URL('../docs/enkyron/sql/118_enkyron_psa_mission_planning.sql', import.meta.url), 'utf8');
  assert.match(sql, /FOREIGN KEY\(workspace_key, company_id\)/);
  assert.match(sql, /FOREIGN KEY\(workspace_key, company_id, opportunity_id\)/);
  assert.match(sql, /UNIQUE\(workspace_key, request_id\)/);
  assert.match(sql, /enkyron_psa_mission_events_immutable/);
  assert.match(sql, /CHECK\(status = 'planning'\)/);
  assert.equal(fs.existsSync(new URL('../migrations/118_enkyron_psa_mission_planning.sql', import.meta.url)), false,
    'REVIEW SQL must never be auto-discoverable by runMigrations');
  assert.doesNotMatch(sql, /\bDROP\s+(TABLE|COLUMN)\b|\bTRUNCATE\b|\bDELETE\s+FROM\b/i);
});
