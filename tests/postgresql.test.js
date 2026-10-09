import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
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
  assert.equal(files.length, 44);
  assert.equal(files.at(-1), '044_risk_knowledge_kb021_session_assurance.sql');
  assert.doesNotMatch(combined, /PRAGMA|BEGIN\s+IMMEDIATE|INSERT\s+OR\s+(?:REPLACE|IGNORE)/i);
  assert.doesNotMatch(combined, /^(?:BEGIN|COMMIT|ROLLBACK)(?:\s+TRANSACTION)?\s*;/gim);
  for (const table of ['users','sessions','assessments','inspections','redteam_runs','beta_invites','workspaces','workspace_members','workspace_integrations','security_projects','project_api_keys','runtime_events','runtime_approvals','asset_snapshots','remediation_items','remediation_evidence_artifacts','remediation_retest_criteria','security_audit_log','sales_prospects','sales_messages','sales_activities','risk_knowledge_entries','risk_knowledge_checks','risk_knowledge_solutions','risk_knowledge_references','risk_knowledge_mappings','risk_knowledge_links','risk_knowledge_applicability_rules','risk_knowledge_operational_metadata','project_risk_knowledge_states','risk_knowledge_validation_records','risk_knowledge_predicate_registry','project_risk_context','risk_knowledge_entry_classification','system_snapshots','control_snapshot_evaluations','control_test_executions','control_evidence_items','control_evidence_trust_revisions','control_deployment_decisions','deployment_decision_evidence','control_snapshot_runtime_bindings','external_intelligence_corpora','external_intelligence_records','external_intelligence_aggregates','owner_assessment_cases']) {
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

test('retired Stripe and billing tables are removed by the final migration', () => {
  const migration = fs.readFileSync(
    path.join(root, 'migrations', '042_retire_stripe_billing.sql'),
    'utf8'
  );

  for (const table of [
    'fulfilment_jobs',
    'stripe_event_recoveries',
    'stripe_subscription_conflicts',
    'subscriptions',
    'stripe_events',
    'purchases'
  ]) {
    assert.match(
      migration,
      new RegExp(`DROP TABLE IF EXISTS ${table}\\b`, 'i')
    );
  }

  const sqlite = fs.readFileSync(
    path.join(root, 'src/db-adapters/sqlite-local.js'),
    'utf8'
  );

  assert.doesNotMatch(
    sqlite,
    /CREATE TABLE IF NOT EXISTS (?:purchases|subscriptions|stripe_events|stripe_event_recoveries|stripe_subscription_conflicts|fulfilment_jobs)\\b/i
  );
  assert.doesNotMatch(
    sqlite,
    /stripe_session_id|stripe_subscription_id|billing_state_source|checkout_mode/i
  );
});

test('release infrastructure keeps product persistence PostgreSQL-only without a Render backend blueprint', () => {
  assert.equal(fs.existsSync(path.join(root, 'render.yaml')), false);
  const docker = fs.readFileSync(path.join(root, 'Dockerfile'), 'utf8');
  const packageJson = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
  const packageLock = JSON.parse(fs.readFileSync(path.join(root, 'package-lock.json'), 'utf8'));
  assert.doesNotMatch(docker, /\/var\/data|sqlite/i);
  assert.match(docker, /npm ci --omit=dev/);
  assert.equal(packageJson.dependencies.pg, '8.23.0');
  assert.equal(packageLock.packages['node_modules/pg'].version, '8.23.0');
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