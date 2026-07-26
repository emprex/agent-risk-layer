#!/usr/bin/env node
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { verifyBackup } from './backup-database.mjs';

export function restoreDatabase(backupPath, destinationUrl, { expectedSha256 = null, force = false, spawn = spawnSync } = {}) {
  if (!force) throw new Error('Restore requires --force and a controlled maintenance window.');
  assertDestination(destinationUrl);
  const verification = verifyBackup(backupPath, { spawn, expectedSha256 });
  const args = [
    '--clean', '--if-exists', '--no-owner', '--no-privileges',
    '--exit-on-error', '--single-transaction', path.resolve(backupPath),
  ];
  const result = spawn('pg_restore', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, PGDATABASE: destinationUrl } });
  if (result?.error) throw new Error(`pg_restore failed: ${result.error.message}`);
  if (result?.status !== 0) throw new Error(`pg_restore failed: ${String(result?.stderr || '').trim() || `exit ${result?.status}`}`);
  return { ok: true, backup: verification.file, destination: redact(destinationUrl), sha256: verification.sha256, restoredAt: new Date().toISOString() };
}
function assertDestination(value) {
  let parsed;
  try { parsed = new URL(String(value || '')); } catch { throw new Error('Destination must be a valid PostgreSQL URL.'); }
  if (!['postgres:', 'postgresql:'].includes(parsed.protocol) || !parsed.hostname || !parsed.pathname.slice(1)) throw new Error('Destination must be a PostgreSQL URL with host and database name.');
}
function redact(value) { const parsed = new URL(value); parsed.username = parsed.username ? '***' : ''; parsed.password = parsed.password ? '***' : ''; return parsed.toString(); }
const isCli = process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url));
if (isCli) {
  const [backup, ...flags] = process.argv.slice(2);
  const destination = process.env.RESTORE_DATABASE_URL;
  if (!backup || !destination) {
    console.error('Usage: RESTORE_DATABASE_URL=postgresql://... node scripts/restore-database-backup.mjs <backup.dump> --force');
    process.exit(1);
  }
  try { console.log(JSON.stringify(restoreDatabase(backup, destination, { force: flags.includes('--force') }), null, 2)); }
  catch (error) { console.error(`Restore failed: ${error.message}`); process.exitCode = 1; }
}
