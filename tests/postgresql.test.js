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
  assert.equal(files.length, 3);
  assert.doesNotMatch(combined, /PRAGMA|BEGIN\s+IMMEDIATE|INSERT\s+OR\s+(?:REPLACE|IGNORE)/i);
  for (const table of ['users','sessions','assessments','purchases','subscriptions','inspections','redteam_runs','beta_invites','workspaces','workspace_members','workspace_integrations','security_projects','project_api_keys','runtime_events','asset_snapshots','remediation_items','security_audit_log']) {
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
