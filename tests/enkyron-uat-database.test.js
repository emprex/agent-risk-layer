import assert from 'node:assert/strict';
import test from 'node:test';
import os from 'node:os';
import {
  ENKYRON_UAT_MARKER, resolveEnkyronDatabase,
  requireEnkyronUatCommand, verifyEnkyronUatDatabase,
} from '../desktop/enkyron-uat-database.mjs';
import {validateBootstrapTarget, migrationAdapter} from '../scripts/enkyron-enk03-uat-bootstrap.mjs';

test('legacy operator database is unchanged if no UAT variables exist', async () => {
  const target = resolveEnkyronDatabase({});
  assert.deepEqual(target, { database: 'arl_local', uat: false });
  requireEnkyronUatCommand(target, 'mail-send-draft');
  await verifyEnkyronUatDatabase({
    query() { throw new Error('UAT guard must not run on normal operator DB'); },
  }, target);
});

test('UAT requires explicit guard and restricted synthetic-only name', () => {
  for (const env of [
    { ENKYRON_UAT_DATABASE: 'enkyron_uat_enk03' },
    { ENKYRON_UAT_GUARD: ENKYRON_UAT_MARKER },
    { ENKYRON_UAT_DATABASE: 'arl_local', ENKYRON_UAT_GUARD: ENKYRON_UAT_MARKER },
    { ENKYRON_UAT_DATABASE: 'postgres', ENKYRON_UAT_GUARD: ENKYRON_UAT_MARKER },
    { ENKYRON_UAT_DATABASE: 'enkyron_uat_enk03;DROP', ENKYRON_UAT_GUARD: ENKYRON_UAT_MARKER },
    { ENKYRON_UAT_DATABASE: 'enkyron_uat_enk03', ENKYRON_UAT_GUARD: 'wrong' },
    { ENKYRON_UAT_DATABASE: '', ENKYRON_UAT_GUARD: ENKYRON_UAT_MARKER },
  ]) assert.throws(() => resolveEnkyronDatabase(env), /ENKYRON UAT requires/);
  assert.deepEqual(resolveEnkyronDatabase({
    ENKYRON_UAT_DATABASE: 'enkyron_uat_enk03',
    ENKYRON_UAT_GUARD: ENKYRON_UAT_MARKER,
  }), { database: 'enkyron_uat_enk03', uat: true });
});

test('UAT permits only synthetic Company 360 flow and no mail/ARL/tickets writes', () => {
  const target = { database: 'enkyron_uat_enk03', uat: true };
  for (const command of [
    'crm-create-company', 'crm-create-contact', 'crm-company-dossier',
    'crm-company-direct-opportunity-create', 'crm-company-followup-create',
  ]) assert.doesNotThrow(() => requireEnkyronUatCommand(target, command));
  for (const command of [
    'mail-send-draft', 'mail-threads', 'assessment-link', 'create-ticket',
    'crm-invoice-issue', 'crm-mail-manual-send', 'calendar-create',
    'crm-company-followup-update', 'crm-edit-company',
  ]) assert.throws(() => requireEnkyronUatCommand(target, command), /UAT blocks/);
});

test('UAT refuses unmarked, wrong or unreadable database before business operation', async () => {
  const target = { database: 'enkyron_uat_enk03', uat: true };
  let calls = 0;
  const valid = {
    async query(sql, params) {
      calls++;
      assert.match(sql, /public.enkyron_uat_guard/);
      assert.deepEqual(params, [ENKYRON_UAT_MARKER]);
      return { rows: [{ database: 'enkyron_uat_enk03', verified: true }] };
    },
  };
  await verifyEnkyronUatDatabase(valid, target);
  assert.equal(calls, 1);
  await assert.rejects(() => verifyEnkyronUatDatabase({
    async query() { return { rows: [{ database: 'arl_local', verified: true }] }; },
  }, target), /not verified/);
  await assert.rejects(() => verifyEnkyronUatDatabase({
    async query() { return { rows: [{ database: target.database, verified: false }] }; },
  }, target), /not verified/);
  await assert.rejects(() => verifyEnkyronUatDatabase({
    async query() { throw new Error('relation enkyron_uat_guard does not exist'); },
  }, target), /does not exist/);
});

test('bootstrap rejects the wrong identity or any existing user tables', () => {
  const target = resolveEnkyronDatabase({
    ENKYRON_UAT_DATABASE: 'enkyron_uat_enk03',
    ENKYRON_UAT_GUARD: ENKYRON_UAT_MARKER,
  });
  const identity = {
    database: 'enkyron_uat_enk03',
    role: os.userInfo().username,
    owner: os.userInfo().username,
  };
  assert.doesNotThrow(() => validateBootstrapTarget(target, identity, []));
  assert.throws(() => validateBootstrapTarget(
    { database: 'arl_local', uat: false }, identity, []
  ), /unexpected UAT database/);
  assert.throws(() => validateBootstrapTarget(
    target, { ...identity, database: 'arl_local' }, []
  ), /identity or ownership/);
  assert.throws(() => validateBootstrapTarget(
    target, { ...identity, owner: 'postgres' }, []
  ), /identity or ownership/);
  assert.throws(() => validateBootstrapTarget(
    target, identity, [{ schemaname: 'public', tablename: 'users' }]
  ), /not empty/);
});

test('bootstrap migration adapter commits marker atomically or rolls back', async () => {
  for (const failMarker of [false, true]) {
    const sqls = [];
    const client = {
      async query(sql, params) {
        sqls.push([sql, params]);
        if (failMarker && sql.includes('CREATE TABLE public.enkyron_uat_guard')) {
          throw new Error('synthetic marker DDL failed');
        }
        if (sql.includes('EXISTS(SELECT 1 FROM public.enkyron_uat_guard')) {
          return { rows: [{ database: 'enkyron_uat_enk03', verified: true }] };
        }
        return { rows: [] };
      },
    };
    const db = migrationAdapter(client);
    const promise = db.transaction(async () => {
      await db.prepare('INSERT INTO t VALUES (?, ?)').run('a', 'b');
      return 42;
    });
    if (failMarker) await assert.rejects(promise, /synthetic marker DDL failed/);
    else assert.equal(await promise, 42);
    assert.deepEqual(sqls[0][0], 'BEGIN');
    const bound = sqls.find(([sql]) => sql.startsWith('INSERT INTO t'));
    assert.equal(bound[0], 'INSERT INTO t VALUES ($1, $2)');
    assert.deepEqual(bound[1], ['a', 'b']);
    assert.equal(sqls.at(-1)[0], failMarker ? 'ROLLBACK' : 'COMMIT');
  }
});
