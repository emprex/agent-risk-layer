// ENK-08: REAL PostgreSQL test on an explicitly guarded, synthetic CI database.
// Never connects to arl_local. No API/email/assessment actions are executed.
import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import path from 'node:path';
import pg from 'pg';
import {createMissionPlan, listMissionPlans} from '../desktop/enkyron-psa-missions.mjs';

const url = process.env.ARL_CI_POSTGRES_URL || '';
const schema = 'enk08_ci_' + randomUUID().replaceAll('-', '');
const uuid = () => randomUUID();
function disposableTarget() {
  assert.equal(process.env.CI, 'true', 'CI=true is required');
  const u = new URL(url);
  assert.equal(u.protocol, 'postgresql:');
  assert.equal(u.hostname, '127.0.0.1');
  const port = Number(process.env.PGPORT);
  assert.ok(Number.isSafeInteger(port) && port > 5432 && port < 65536,
    'A separate PostgreSQL port is required; 5432 is production');
  assert.equal(u.port, String(port));
  assert.equal(process.env.PGVERSION, '17', 'Temporary PG17 only');
  const root = path.resolve(process.env.PG_CLUSTER_CONF_ROOT || '/');
  assert.equal(path.basename(root), 'postgresql');
  assert.match(path.basename(path.dirname(root)), /^pg_virtualenv\.[A-Za-z0-9]+$/,
    'Requires a Debian pg_virtualenv temporary cluster');
  assert.equal(u.pathname, '/arl_ci');
  assert.equal(u.username, 'arl_ci');
  assert.equal(u.password, 'synthetic-ci-only');
  assert.equal(u.search, '', 'Connection overrides forbidden');
  assert.equal(u.hash, '', 'Connection fragment forbidden');
  return url;
}
const fixture = [
  'CREATE TABLE enkyron_crm_companies (',
  'id TEXT PRIMARY KEY, workspace_key TEXT NOT NULL, name TEXT NOT NULL,',
  'UNIQUE(workspace_key,id));',
  'CREATE TABLE enkyron_crm_opportunities (',
  'id TEXT PRIMARY KEY, workspace_key TEXT NOT NULL, company_id TEXT,',
  "stage TEXT NOT NULL DEFAULT 'research',",
  'UNIQUE(workspace_key,id),',
  'FOREIGN KEY(workspace_key,company_id)',
  'REFERENCES enkyron_crm_companies(workspace_key,id));',
  'CREATE FUNCTION enkyron_crm_events_immutable() RETURNS trigger AS $$',
  "BEGIN RAISE EXCEPTION 'ENKYRON CRM events cannot be changed or deleted'; END;",
  '$$ LANGUAGE plpgsql;',
].join('\n');
function missionInput(company, opportunity = null, requestId = uuid()) {
  return {
    company_id: company, opportunity_id: opportunity, request_id: requestId,
    title: 'Synthetic engagement planning',
    description: 'Prepare a synthetic client mission without any external action.',
    due_date: '2026-12-18', confirmed: true,
  };
}

test('ENK-08: disposable PostgreSQL SQL constraints, concurrent retry and rollback', {
  skip: !url && 'Requires dedicated ARL_CI_POSTGRES_URL', timeout: 60000,
}, async () => {
  const connectionString = disposableTarget();
  assert.match(schema, /^enk08_ci_[a-f0-9]{32}$/);
  const admin = new pg.Client({connectionString, connectionTimeoutMillis: 3000});
  let pool;
  let created = false;
  try {
    await admin.connect();
    // Ordinary test role has no pg_read_all_settings. The privileged config
    // and data-directory checks were already performed by the verified launcher
    // before it created this role/database. Do not expand the test role grants.
    const target = (await admin.query(
      'SELECT current_database() AS database, current_user AS role, '
      + 'inet_server_port() AS port, inet_server_addr()::text AS address'
    )).rows[0];
    assert.deepEqual(target, {
      database: 'arl_ci', role: 'arl_ci',
      port: Number(process.env.PGPORT), address: '127.0.0.1',
    });
    await admin.query('CREATE SCHEMA ' + schema);
    created = true;
    pool = new pg.Pool({
      connectionString, max: 10, connectionTimeoutMillis: 3000,
      options: '-c search_path=' + schema + ' -c statement_timeout=8000 -c lock_timeout=4000',
    });
    const active = (await pool.query('SELECT current_schema() AS schema')).rows[0];
    assert.equal(active.schema, schema, 'Refuse default/public search_path');
    await pool.query(fixture);
    await pool.query(await readFile(
      new URL('../docs/enkyron/sql/118_enkyron_psa_mission_planning.sql', import.meta.url), 'utf8'
    ));

    const company = uuid(), otherCompany = uuid(), outside = uuid();
    const opportunity = uuid(), wrongOpportunity = uuid(), foreignOpportunity = uuid();
    const actor = 'ci-mission-owner', foreignActor = 'ci-mission-outsider';
    await pool.query(
      'INSERT INTO enkyron_crm_companies(id,workspace_key,name) '
      + 'VALUES($1,$2,$3),($4,$2,$5),($6,$7,$8)',
      [company, 'local:' + actor, 'Synthetic Client',
        otherCompany, 'Other Client', outside, 'local:' + foreignActor, 'Foreign Client']
    );
    await pool.query(
      'INSERT INTO enkyron_crm_opportunities(id,workspace_key,company_id) '
      + 'VALUES($1,$2,$3),($4,$2,$5),($6,$7,$8)',
      [opportunity, 'local:' + actor, company,
        wrongOpportunity, otherCompany,
        foreignOpportunity, 'local:' + foreignActor, outside]
    );

    const requestId = uuid();
    const input = missionInput(company, opportunity, requestId);
    const first = await createMissionPlan(pool, input, actor);
    assert.deepEqual([first.status, first.version, first.created], ['planning', 1, true]);
    assert.equal((await listMissionPlans(pool, actor)).items.length, 1);
    assert.equal((await listMissionPlans(pool, foreignActor)).items.length, 0);
    assert.equal((await listMissionPlans(pool, actor, otherCompany)).items.length, 0);
    assert.equal((await listMissionPlans(pool, actor, company)).items[0].id, first.id);
    const replay = await createMissionPlan(pool, input, actor);
    assert.deepEqual([replay.id, replay.created], [first.id, false]);
    await assert.rejects(
      createMissionPlan(pool, {...input, title: 'Different synthetic mission'}, actor), /reused/
    );
    for (const [badInput, badActor] of [
      [missionInput(company, wrongOpportunity), actor],
      [missionInput(company, foreignOpportunity), actor],
      [missionInput(outside), actor],
      [missionInput(company), foreignActor],
    ]) {
      await assert.rejects(createMissionPlan(pool, badInput, badActor), /PSA/);
    }

    // The composite FK must reject direct SQL bypass attempts as well.
    await assert.rejects(pool.query(
      'INSERT INTO enkyron_psa_missions '
      + '(id,workspace_key,company_id,opportunity_id,title,description,request_id,content_sha256,created_by) '
      + 'VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)',
      [uuid(), 'local:' + actor, company, wrongOpportunity,
        input.title, input.description, uuid(), 'a'.repeat(64), actor]
    ), err => err.code === '23503');

    // Concurrent requests share a request ID and must commit exactly one audit event.
    const simultaneousId = uuid();
    const simultaneous = await Promise.all(Array.from({length: 6}, () =>
      createMissionPlan(pool, missionInput(company, opportunity, simultaneousId), actor)
    ));
    assert.equal(simultaneous.filter(x => x.created).length, 1);
    assert.equal(new Set(simultaneous.map(x => x.id)).size, 1);
    const count = (await pool.query(
      'SELECT count(*)::int AS count FROM enkyron_psa_mission_events '
      + 'WHERE workspace_key=$1 AND request_id=$2',
      ['local:' + actor, simultaneousId]
    )).rows[0].count;
    assert.equal(count, 1);

    // Audit and mission state are protected by real PostgreSQL constraints.
    await assert.rejects(pool.query(
      'UPDATE enkyron_psa_mission_events SET actor_local=$1 WHERE mission_id=$2',
      ['changed', first.id]
    ), /cannot be changed or deleted/);
    await assert.rejects(pool.query(
      'DELETE FROM enkyron_psa_mission_events WHERE mission_id=$1', [first.id]
    ), /cannot be changed or deleted/);
    await assert.rejects(pool.query(
      'UPDATE enkyron_psa_missions SET status=$1 WHERE id=$2', ['active', first.id]
    ), err => err.code === '23514');

    // A failing audit insert must rollback the entire new mission creation.
    const usedEventId = (await pool.query(
      'SELECT id FROM enkyron_psa_mission_events WHERE mission_id=$1', [first.id]
    )).rows[0].id;
    const failedRequest = uuid(), generatedIds = [uuid(), usedEventId];
    await assert.rejects(createMissionPlan(
      pool, missionInput(company, null, failedRequest), actor,
      {uuid: () => generatedIds.shift()}
    ), err => err.code === '23505');
    assert.equal((await pool.query(
      'SELECT count(*)::int AS count FROM enkyron_psa_missions WHERE request_id=$1',
      [failedRequest]
    )).rows[0].count, 0);
    const summary = (await pool.query(
      'SELECT (SELECT count(*) FROM enkyron_psa_missions)::int AS missions, '
      + '(SELECT count(*) FROM enkyron_psa_mission_events)::int AS events'
    )).rows[0];
    assert.deepEqual(summary, {missions: 2, events: 2});
  } finally {
    if (pool) await pool.end();
    // Only the uniquely generated disposable schema, in the checked arl_ci DB.
    if (created) await admin.query('DROP SCHEMA ' + schema + ' CASCADE');
    await admin.end();
  }
});
