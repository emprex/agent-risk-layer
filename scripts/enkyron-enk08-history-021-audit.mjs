#!/usr/bin/env node
// ENK-08 historical migration forensics: READ ONLY, never repairs history.
// Verifies exactly one archived file from a fixed Git commit against its
// exact recorded filename/sha256 in arl_local.schema_migrations.
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {access} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import pg from 'pg';

export const HISTORICAL = Object.freeze({
  version: '021_paid_assessment_remediation_scope.sql',
  commit: 'e644d51cfdf256e04989dafc45b4cea4a4e23aa4',
  sha256: '673d3ce1373cf5dcde3414fee08c3dba15cadb0ca2f32afd7c50316fe5b1d7f6',
});
const THIS = fileURLToPath(import.meta.url);
const ROOT = path.resolve(path.dirname(THIS), '..');

export function compareArchivedMigration(bytes, recordedChecksum, activeSourcePresent) {
  if (!Buffer.isBuffer(bytes) || typeof recordedChecksum !== 'string'
      || typeof activeSourcePresent !== 'boolean')
    throw new Error('STOP: invalid migration audit inputs');
  const archiveSha = createHash('sha256').update(bytes).digest('hex');
  const sourceMatches = archiveSha === HISTORICAL.sha256;
  const ledgerMatches = recordedChecksum === HISTORICAL.sha256;
  const issues = [];
  if (!sourceMatches) issues.push('archived source bytes do not match verified SHA-256');
  if (!ledgerMatches) issues.push('recorded exact-filename SHA-256 does not match archive');
  if (activeSourcePresent) {
    issues.push('historical 021 unexpectedly present in auto-scanned migrations');
  }
  return {
    migration: HISTORICAL.version,
    source_commit: HISTORICAL.commit,
    archive_sha256: archiveSha,
    ledger_checksum_matches_archive: sourceMatches && ledgerMatches,
    active_source_present: activeSourcePresent,
    provenance_verified_for_review: issues.length === 0,
    issues,
    ledger_modified: false, archive_restored: false,
    migration_executed: false, release_approved: false,
  };
}

function showHistoricBytes() {
  // Fixed commit and relative path, no shell expansion or network.
  return execFileSync('git', [
    'show', HISTORICAL.commit + ':migrations/' + HISTORICAL.version,
  ], {cwd: ROOT, timeout: 6000, maxBuffer: 1024 * 1024});
}

async function activeSourceExists() {
  try {
    await access(path.join(ROOT, 'migrations', HISTORICAL.version));
    return true;
  } catch (error) {
    if (error?.code === 'ENOENT') return false;
    throw error;
  }
}

export async function auditEnk08Historical021() {
  const bytes = showHistoricBytes();
  const currentFilePresent = await activeSourceExists();
  const actor = os.userInfo().username;
  const client = new pg.Client({
    host: '/var/run/postgresql', port: 5432,
    database: 'arl_local', user: actor,
    connectionTimeoutMillis: 5000,
    options: '-c default_transaction_read_only=on -c statement_timeout=5000',
  });
  await client.connect();
  let active = false;
  try {
    await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
    active = true;
    const identity = (await client.query(
      "SELECT current_database() AS database, current_user AS actor, "
      + "current_setting('transaction_read_only') AS read_only"
    )).rows[0];
    if (identity?.database !== 'arl_local' || identity?.actor !== actor
        || identity?.read_only !== 'on')
      throw new Error('STOP: unexpected PostgreSQL database or non-read-only transaction');
    const ledger = (await client.query(
      'SELECT checksum FROM schema_migrations WHERE version=$1',
      [HISTORICAL.version]
    )).rows;
    if (ledger.length !== 1) throw new Error('STOP: historical 021 ledger entry missing');
    const report = compareArchivedMigration(bytes, ledger[0].checksum, currentFilePresent);
    await client.query('COMMIT');
    active = false;
    return {database: identity.database, actor: identity.actor,
      read_only: true, ...report,
      release_gate: 'STOP — all pending migrations, backup/restore, full-schema rehearsal and authorization remain unreviewed'};
  } finally {
    if (active) await client.query('ROLLBACK').catch(() => {});
    await client.end();
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === THIS) {
  if (process.argv.length !== 3 || process.argv[2] !== '--check') {
    console.error('Usage: node scripts/enkyron-enk08-history-021-audit.mjs --check');
    process.exitCode = 2;
  } else {
    auditEnk08Historical021().then(report => {
      console.log(JSON.stringify(report, null, 2));
      console.log('ENK-08 HISTORY PROVENANCE: '
        + (report.provenance_verified_for_review ? 'VERIFIED FOR REVIEW' : 'STOP'));
      console.log('ENK-08 PRODUCTION MIGRATIONS: RELEASE STOP');
      if (!report.provenance_verified_for_review) process.exitCode = 2;
    }).catch(error => {
      console.error('ENK-08 HISTORY AUDIT: STOP — ' + String(error?.message || error));
      process.exitCode = 2;
    });
  }
}
