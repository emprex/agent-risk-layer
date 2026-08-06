import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { DatabaseSync } from 'node:sqlite';
import { createPostgresDatabase, translatePlaceholders } from '../src/db-adapters/postgres.js';
import { runMigrations } from '../src/migrations.js';

const root = path.resolve(import.meta.dirname, '..');

test('PostgreSQL placeholder translation preserves literals and comments', () => {
  const sql = "SELECT '?' literal, value FROM checks WHERE a=? AND b='it''s ?' -- ?\n AND c=? /* ? */ AND d=$tag$?$tag$";
  assert.equal(translatePlaceholders(sql), "SELECT '?' literal, value FROM checks WHERE a=$1 AND b='it''s ?' -- ?\n AND c=$2 /* ? */ AND d=$tag$?$tag$");
});

test('PostgreSQL adapter uses parameterised pool queries and transaction-bound clients', async () => {
  const poolQueries = [];
  const clientQueries = [];
  class FakePool {
    on() {}
    async query(sql, params = []) {
      poolQueries.push({ sql, params });
      if (sql.startsWith('SELECT current_database')) return { rows: [{ database: 'agentrisklayer', user: 'arl', version: 'PostgreSQL test' }], rowCount: 1 };
      return { rows: [{ id: 'row_1' }], rowCount: 1 };
    }
    async connect() {
      return {
        query: async (sql, params = []) => { clientQueries.push({ sql, params }); return { rows: [{ id: 'tx_1' }], rowCount: 1 }; },
        release() { clientQueries.push({ sql: 'RELEASE', params: [] }); },
      };
    }
    async end() {}
  }
  const db = await createPostgresDatabase({
    databaseUrl: 'postgresql://arl:secret@db.internal/agentrisklayer', databasePoolMax: 4,
    databaseIdleTimeoutMs: 30000, databaseConnectTimeoutMs: 10000, databaseSsl: false,
    databaseSslRejectUnauthorized: true, nodeEnv: 'test', databaseStatementTimeoutMs: 15000, databaseLockTimeoutMs: 5000,
  }, { Pool: FakePool, types: { setTypeParser() {} } });
  const row = await db.prepare('SELECT * FROM users WHERE id=? AND email=?').get('usr_1', 'owner@example.com');
  assert.equal(row.id, 'row_1');
  assert.equal(poolQueries[0].sql, 'SELECT * FROM users WHERE id=$1 AND email=$2');
  assert.deepEqual(poolQueries[0].params, ['usr_1', 'owner@example.com']);
  await db.transaction(async () => {
    await db.prepare('UPDATE users SET role=? WHERE id=?').run('superuser', 'usr_1');
  });
  assert.deepEqual(clientQueries.map((entry) => entry.sql), ['BEGIN', 'UPDATE users SET role=$1 WHERE id=$2', 'COMMIT', 'RELEASE']);
  assert.equal((await db.healthcheck()).adapter, 'postgres');
});

test('PostgreSQL adapter rejects SQLite-only statements', async () => {
  class FakePool { on() {} async query(){ return { rows: [], rowCount: 0 }; } async end() {} }
  const db = await createPostgresDatabase({ databaseUrl:'postgresql://a:b@db/x', databasePoolMax:2, databaseIdleTimeoutMs:30000, databaseConnectTimeoutMs:10000, databaseSsl:false, databaseSslRejectUnauthorized:true, nodeEnv:'test', databaseStatementTimeoutMs:15000, databaseLockTimeoutMs:5000 }, { Pool: FakePool });
  await assert.rejects(() => db.exec('PRAGMA quick_check'), /SQLite-only SQL/);
  await assert.rejects(() => db.exec('BEGIN IMMEDIATE'), /SQLite-only SQL/);
  await assert.rejects(() => db.exec('INSERT OR REPLACE INTO users VALUES (?)'), /SQLite-only SQL/);
});

test('PostgreSQL migrations are complete, portable and checksum-idempotent', async () => {
  const migrationDir = path.join(root, 'migrations');
  const files = fs.readdirSync(migrationDir).filter((name) => /^\d{3}_.+\.sql$/.test(name)).sort();
  const combined = files.map((name) => fs.readFileSync(path.join(migrationDir, name), 'utf8')).join('\n');
  assert.equal(files.length, 15);
  assert.doesNotMatch(combined, /PRAGMA|BEGIN\s+IMMEDIATE|INSERT\s+OR\s+(?:REPLACE|IGNORE)/i);
  assert.doesNotMatch(combined, /^(?:BEGIN|COMMIT|ROLLBACK)(?:\s+TRANSACTION)?\s*;/gim);
  for (const table of ['users','sessions','assessments','purchases','subscriptions','stripe_event_recoveries','stripe_subscription_conflicts','inspections','redteam_runs','beta_invites','workspaces','workspace_members','workspace_integrations','security_projects','project_api_keys','runtime_events','runtime_approvals','asset_snapshots','remediation_items','remediation_evidence_artifacts','remediation_retest_criteria','security_audit_log','sales_prospects','sales_messages','sales_activities','risk_knowledge_entries','risk_knowledge_checks','risk_knowledge_solutions','risk_knowledge_references','risk_knowledge_mappings','risk_knowledge_links','risk_knowledge_applicability_rules','risk_knowledge_operational_metadata','project_risk_knowledge_states','risk_knowledge_validation_records','risk_knowledge_predicate_registry','project_risk_context','risk_knowledge_entry_classification','system_snapshots','control_snapshot_evaluations','control_test_executions','control_evidence_items','control_deployment_decisions','deployment_decision_evidence','control_snapshot_runtime_bindings']) {
    assert.match(combined, new RegExp(`CREATE TABLE IF NOT EXISTS ${table}\\b`));
  }
  const duplicates = [];
  for (const match of combined.matchAll(/CREATE TABLE IF NOT EXISTS\s+(\w+)\s*\((.*?)\);/gs)) {
    const seen = new Set();
    for (const raw of match[2].split('\n')) {
      const line = raw.trim().replace(/,$/, '');
      if (!line || /^(?:PRIMARY|FOREIGN|UNIQUE|CHECK|CONSTRAINT)\b/i.test(line)) continue;
      const column = line.split(/\s+/)[0].replaceAll('"', '');
      if (seen.has(column)) duplicates.push(`${match[1]}.${column}`);
      seen.add(column);
    }
  }
  assert.deepEqual(duplicates, []);

  const applied = new Map();
  const fakeDb = {
    kind: 'postgres',
    async transaction(callback) { return callback(); },
    async exec() {},
    prepare(sql) {
      return {
        async all() { return sql.startsWith('SELECT version') ? [...applied].map(([version, checksum]) => ({ version, checksum })) : []; },
        async run(version, checksum) { if (sql.startsWith('INSERT INTO schema_migrations')) applied.set(version, checksum); return { changes: 1 }; },
      };
    },
  };
  const first = await runMigrations(fakeDb);
  const second = await runMigrations(fakeDb);
  assert.deepEqual(first.applied, files);
  assert.deepEqual(second.skipped, files);
});


test('runtime approval integrity migration is additive and enforces a single-use ledger', () => {
  const migration = fs.readFileSync(path.join(root, 'migrations', '008_runtime_approval_integrity.sql'), 'utf8');
  assert.match(migration, /CREATE TABLE IF NOT EXISTS runtime_approvals/);
  assert.match(migration, /token_digest TEXT NOT NULL UNIQUE/);
  assert.match(migration, /status IN \('active','consumed','revoked'\)/);
  assert.match(migration, /consumed_request_id/);
  assert.match(migration, /runtime_event_id TEXT REFERENCES runtime_events/);
  assert.match(migration, /approver_id TEXT REFERENCES users\(id\) ON DELETE SET NULL/);
  assert.doesNotMatch(migration, /approver_id TEXT NOT NULL/);
  assert.match(migration, /WHERE consumed_request_id IS NOT NULL/);
  assert.doesNotMatch(migration, /\bDROP\s+(?:TABLE|COLUMN)\b/i);
  assert.doesNotMatch(migration, /\bDELETE\s+FROM\b/i);
});

test('billing integrity migration is additive and preserves legacy purchases', () => {
  const migration = fs.readFileSync(path.join(root, 'migrations', '007_billing_integrity.sql'), 'utf8');
  assert.match(migration, /legacy_fulfilled/);
  assert.match(migration, /legacy_review_required/);
  assert.match(migration, /attempt_count/);
  assert.match(migration, /completed_at/);
  assert.match(migration, /latest_stripe_event_created/);
  assert.match(migration, /stripe_event_recoveries/);
  assert.match(migration, /stripe_subscription_conflicts/);
  assert.match(migration, /legacy_reconciliation_required/);
  assert.match(migration, /billing_state_source\s+IS\s+NOT\s+NULL\s+AND\s*\(/i);
  assert.match(migration, /ALTER\s+COLUMN\s+billing_state_source\s+SET\s+NOT\s+NULL/i);
  assert.match(migration, /billing_state_source\s+NOT\s+IN\s*\(\s*'pending_checkout','legacy_reconciliation_required','reconciliation_required','stripe_event','stripe_retrieval'\s*\)/i);
  assert.doesNotMatch(migration, /SET\s+authoritative_state\s*=\s*TRUE[\s\S]*WHERE\s+billing_state_source\s+IS\s+NULL/i);
  assert.match(migration, /NOT VALID/);
  assert.match(migration, /VALIDATE CONSTRAINT/);
  assert.doesNotMatch(migration, /\bDELETE\s+FROM\s+(?:purchases|stripe_events)\b/i);
  assert.doesNotMatch(migration, /\bDROP\s+(?:TABLE|COLUMN)\b/i);
});

test('real SQLite adapter rebuild preserves legacy subscriptions and enforces lifecycle classifications', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'arl-legacy-billing-'));
  const databasePath = path.join(directory, 'legacy.sqlite');
  const database = new DatabaseSync(databasePath);
  try {
    database.exec(`PRAGMA foreign_keys=ON;
      CREATE TABLE users (
        id TEXT PRIMARY KEY, email TEXT NOT NULL UNIQUE, password_hash TEXT NOT NULL, created_at TEXT NOT NULL
      );
      CREATE TABLE subscriptions (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        plan_key TEXT NOT NULL,
        status TEXT NOT NULL,
        stripe_customer_id TEXT,
        stripe_subscription_id TEXT UNIQUE,
        current_period_end TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE TABLE stripe_subscription_conflicts (
        id TEXT PRIMARY KEY,
        subscription_id TEXT NOT NULL REFERENCES subscriptions(id) ON DELETE RESTRICT,
        stripe_created INTEGER NOT NULL,
        prior_event_id TEXT NOT NULL,
        prior_event_type TEXT NOT NULL,
        conflicting_event_id TEXT NOT NULL,
        conflicting_event_type TEXT NOT NULL,
        prior_state TEXT NOT NULL,
        conflicting_state TEXT NOT NULL,
        reason TEXT NOT NULL,
        created_at TEXT NOT NULL,
        resolved_at TEXT,
        resolving_event_id TEXT,
        UNIQUE(subscription_id,prior_event_id,conflicting_event_id)
      );
      INSERT INTO users (id,email,password_hash,created_at)
        VALUES ('usr_legacy','legacy@example.test','test-only','2026-01-01T00:00:00.000Z');`);
    const insert = database.prepare(`INSERT INTO subscriptions
      (id,user_id,plan_key,status,stripe_customer_id,stripe_subscription_id,current_period_end,created_at,updated_at)
      VALUES (?,'usr_legacy','developer_monthly',?,'cus_legacy',?,?,?,?)`);
    const future = new Date(Date.now() + 86400000).toISOString();
    const expired = new Date(Date.now() - 86400000).toISOString();
    for (const row of [
      ['legacy-active-valid', 'active', future],
      ['legacy-active-expired', 'active', expired],
      ['legacy-active-missing', 'active', null],
      ['legacy-active-malformed', 'active', 'not-a-date'],
      ['legacy-trialing-valid', 'trialing', future],
      ['legacy-cancelled-valid', 'canceled', future],
      ['legacy-pending', 'pending', null],
    ]) insert.run(row[0], row[1], `sub_${row[0]}`, row[2], '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z');
    database.prepare(`INSERT INTO stripe_subscription_conflicts
      (id,subscription_id,stripe_created,prior_event_id,prior_event_type,conflicting_event_id,
       conflicting_event_type,prior_state,conflicting_state,reason,created_at)
      VALUES ('conflict_legacy','legacy-active-valid',1,'evt_prior','customer.subscription.updated',
        'evt_conflict','customer.subscription.deleted','{}','{}','preserved conflict',
        '2026-01-01T00:00:00.000Z')`).run();
    database.close();

    initialiseSqliteAdapter(databasePath);
    initialiseSqliteAdapter(databasePath);

    const upgraded = new DatabaseSync(databasePath);
    upgraded.exec('PRAGMA foreign_keys=ON;');
    const rows = upgraded.prepare('SELECT * FROM subscriptions ORDER BY id').all();
    assert.equal(rows.length, 7);
    for (const row of rows) {
      assert.equal(Number(row.authoritative_state), 0);
      assert.equal(Number(row.reconciliation_required), 0);
      assert.equal(row.billing_state_source, 'legacy_reconciliation_required');
    }
    assert.equal(rows.find((row) => row.id === 'legacy-active-valid').current_period_end, future);
    assert.equal(rows.find((row) => row.id === 'legacy-active-expired').current_period_end, expired);
    assert.equal(rows.find((row) => row.id === 'legacy-active-missing').current_period_end, null);
    assert.equal(rows.find((row) => row.id === 'legacy-active-malformed').current_period_end, 'not-a-date');
    assert.equal(rows.find((row) => row.id === 'legacy-cancelled-valid').status, 'canceled');
    assert.equal(rows.find((row) => row.id === 'legacy-trialing-valid').status, 'trialing');
    assert.equal(rows.find((row) => row.id === 'legacy-pending').status, 'pending');
    assert.equal(rows.find((row) => row.id === 'legacy-active-valid').stripe_customer_id, 'cus_legacy');
    assert.equal(rows.find((row) => row.id === 'legacy-active-valid').stripe_subscription_id, 'sub_legacy-active-valid');

    const columns = upgraded.prepare(`PRAGMA table_info(subscriptions)`).all();
    assert.equal(columns.find((column) => column.name === 'billing_state_source').notnull, 1);
    assert.deepEqual(upgraded.prepare('PRAGMA foreign_key_check').all(), []);
    const indexes = new Set(upgraded.prepare(`PRAGMA index_list(subscriptions)`).all().map((index) => index.name));
    assert.ok(indexes.has('idx_subscriptions_purchase'));
    assert.ok(indexes.has('idx_subscriptions_stripe_order'));
    assert.ok([...indexes].some((name) => name.startsWith('sqlite_autoindex_subscriptions_')));
    const preservedConflict = upgraded.prepare(`SELECT * FROM stripe_subscription_conflicts
      WHERE id='conflict_legacy'`).get();
    assert.equal(preservedConflict.subscription_id, 'legacy-active-valid');
    assert.equal(preservedConflict.reason, 'preserved conflict');

    const timestamp = '2026-01-02T00:00:00.000Z';
    const later = '2026-02-02T00:00:00.000Z';
    const insertState = upgraded.prepare(`INSERT INTO subscriptions
      (id,user_id,plan_key,status,stripe_subscription_id,purchase_id,current_period_start,current_period_end,
       authoritative_state,billing_state_source,latest_stripe_event_created,latest_stripe_event_id,
       latest_stripe_event_type,latest_stripe_event_state,reconciliation_required,reconciliation_started_at,
       created_at,updated_at)
      VALUES (?,'usr_legacy','developer_monthly',?,?,NULL,?,?,?,?,?,?,?,?,?,?,?,?)`);
    const state = ({
      id, status = 'active', source = 'stripe_event', authoritative = 1,
      start = timestamp, end = later, orderCreated = 100, orderId = `evt_${id}`,
      orderType = 'customer.subscription.updated', orderState = status,
      reconciliation = 0, reconciliationStarted = null,
    }) => [
      id, status, `sub_${id}`, start, end, authoritative, source, orderCreated, orderId,
      orderType, orderState, reconciliation, reconciliationStarted, timestamp, timestamp,
    ];
    const rejects = (values) => assert.throws(() => insertState.run(...values), /(?:NOT NULL|CHECK) constraint failed/);
    rejects(state({
      id: 'invalid-null-pending', status: 'pending', source: null, authoritative: 0,
      start: null, end: null, orderCreated: null, orderId: null, orderType: null, orderState: null,
    }));
    rejects(state({ id: 'invalid-null-authority', source: null }));
    rejects(state({
      id: 'invalid-unknown-legacy', source: 'invented', authoritative: 0,
      orderCreated: null, orderId: null, orderType: null, orderState: null,
    }));
    rejects(state({ id: 'invalid-unknown-authority', source: 'invented' }));
    rejects(state({
      id: 'invalid-pending-active', source: 'pending_checkout', authoritative: 0,
      start: null, end: null, orderCreated: null, orderId: null, orderType: null, orderState: null,
    }));

    insertState.run(...state({
      id: 'valid-pending', status: 'pending', source: 'pending_checkout', authoritative: 0,
      start: null, end: null, orderCreated: null, orderId: null, orderType: null, orderState: null,
    }));
    insertState.run(...state({
      id: 'valid-legacy', source: 'legacy_reconciliation_required', authoritative: 0,
      orderCreated: null, orderId: null, orderType: null, orderState: null,
    }));
    insertState.run(...state({ id: 'valid-stripe-event' }));
    insertState.run(...state({ id: 'valid-stripe-retrieval', source: 'stripe_retrieval' }));
    insertState.run(...state({
      id: 'valid-reconciliation', source: 'reconciliation_required', authoritative: 0,
      reconciliation: 1, reconciliationStarted: timestamp,
    }));
    upgraded.prepare(`UPDATE subscriptions SET authoritative_state=1,billing_state_source='stripe_event',
      reconciliation_required=0,reconciliation_started_at=NULL,latest_stripe_event_created=101,
      latest_stripe_event_id='evt_resolution',latest_stripe_event_type='customer.subscription.updated',
      latest_stripe_event_state='active' WHERE id='valid-reconciliation'`).run();
    assert.equal(upgraded.prepare(`SELECT billing_state_source FROM subscriptions WHERE id='valid-reconciliation'`).get().billing_state_source, 'stripe_event');
    assert.deepEqual(upgraded.prepare('PRAGMA foreign_key_check').all(), []);
    upgraded.close();
  } finally {
    try { database.close(); } catch {}
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test('SQLite subscription rebuild failure rolls back to the usable original table', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'arl-legacy-billing-rollback-'));
  const databasePath = path.join(directory, 'legacy.sqlite');
  const database = new DatabaseSync(databasePath);
  try {
    database.exec(`CREATE TABLE users (
        id TEXT PRIMARY KEY, email TEXT NOT NULL UNIQUE, password_hash TEXT NOT NULL, created_at TEXT NOT NULL
      );
      CREATE TABLE subscriptions (
        id TEXT PRIMARY KEY, user_id TEXT NOT NULL, plan_key TEXT NOT NULL, status TEXT NOT NULL,
        stripe_customer_id TEXT, stripe_subscription_id TEXT UNIQUE, current_period_end TEXT,
        created_at TEXT NOT NULL, updated_at TEXT NOT NULL
      );
      INSERT INTO users VALUES ('usr_rollback','rollback@example.test','test-only','2026-01-01T00:00:00.000Z');
      INSERT INTO subscriptions VALUES
        ('subrec_rollback','usr_rollback','developer_monthly','unsupported_status','cus_rollback',
         'sub_rollback','preserved-period','2026-01-01T00:00:00.000Z','2026-01-01T00:00:00.000Z');`);
    database.close();
    const attempt = runSqliteAdapter(databasePath);
    assert.notEqual(attempt.status, 0);
    const preserved = new DatabaseSync(databasePath);
    const row = preserved.prepare(`SELECT * FROM subscriptions WHERE id='subrec_rollback'`).get();
    assert.equal(row.status, 'unsupported_status');
    assert.equal(row.current_period_end, 'preserved-period');
    assert.deepEqual(preserved.prepare('PRAGMA table_info(subscriptions)').all().map((column) => column.name), [
      'id', 'user_id', 'plan_key', 'status', 'stripe_customer_id', 'stripe_subscription_id',
      'current_period_end', 'created_at', 'updated_at',
    ]);
    assert.equal(preserved.prepare(`SELECT COUNT(*) count FROM subscriptions`).get().count, 1);
    assert.equal(preserved.prepare(`SELECT COUNT(*) count FROM sqlite_master
      WHERE type='table' AND name='subscriptions_billing_upgrade'`).get().count, 0);
    preserved.close();
  } finally {
    try { database.close(); } catch {}
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

function runSqliteAdapter(databasePath) {
  return spawnSync(process.execPath, ['--input-type=module', '--eval',
    `await import(${JSON.stringify(path.join(root, 'src/db-adapters/sqlite-local.js'))});`], {
    cwd: root,
    env: { ...process.env, NODE_ENV: 'test', DATABASE_PATH: databasePath, ADMIN_EMAIL: '' },
    encoding: 'utf8',
    timeout: 15000,
  });
}

function initialiseSqliteAdapter(databasePath) {
  const result = runSqliteAdapter(databasePath);
  assert.equal(result.status, 0, `SQLite adapter initialization failed:\n${result.stderr}\n${result.stdout}`);
}

test('release infrastructure contains PostgreSQL only and no persistent SQLite disk', () => {
  const render = fs.readFileSync(path.join(root, 'render.yaml'), 'utf8');
  const docker = fs.readFileSync(path.join(root, 'Dockerfile'), 'utf8');
  const packageJson = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
  const packageLock = JSON.parse(fs.readFileSync(path.join(root, 'package-lock.json'), 'utf8'));
  assert.match(render, /fromDatabase:[\s\S]*property: connectionString/);
  assert.match(render, /databases:[\s\S]*plan: basic-1gb/);
  assert.match(render, /healthCheckPath: \/api\/ready/);
  assert.match(render, /diskSizeGB: 25/);
  assert.match(render, /storageAutoscalingEnabled: true/);
  assert.doesNotMatch(render, /DATABASE_PATH|\bdisk:/);
  assert.doesNotMatch(docker, /\/var\/data|sqlite/i);
  assert.match(docker, /npm ci --omit=dev/);
  assert.equal(packageJson.dependencies.pg, '8.22.0');
  assert.equal(packageLock.packages['node_modules/pg'].version, '8.22.0');
  for (const dependency of ['pg','pg-cloudflare','pg-connection-string','pg-int8','pg-pool','pg-protocol','pg-types','pgpass','postgres-array','postgres-bytea','postgres-date','postgres-interval','split2','xtend']) {
    const locked = packageLock.packages[`node_modules/${dependency}`];
    assert.ok(locked, `lockfile missing ${dependency}`);
    assert.match(locked.resolved, /^https:\/\/registry\.npmjs\.org\//, `lockfile registry missing for ${dependency}`);
    assert.match(locked.integrity, /^sha512-/, `lockfile integrity missing for ${dependency}`);
  }
  for (const file of ['server.js', ...fs.readdirSync(path.join(root, 'src')).filter((name) => name.endsWith('.js')).map((name) => `src/${name}`)]) {
    const source = fs.readFileSync(path.join(root, file), 'utf8');
    assert.doesNotMatch(source, /BEGIN\s+IMMEDIATE|INSERT\s+OR\s+(?:REPLACE|IGNORE)|\bPRAGMA\b/i, file);
  }
});
