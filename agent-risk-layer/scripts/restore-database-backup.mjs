#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';

export function restoreDatabase(backupPath, destinationPath, { expectedSha256 = null, force = false } = {}) {
  const backup = path.resolve(backupPath);
  const destination = path.resolve(destinationPath);
  if (!fs.existsSync(backup)) throw new Error(`Backup not found: ${backup}`);
  const digest = sha256(backup);
  const manifestPath = `${backup}.manifest.json`;
  if (fs.existsSync(manifestPath)) {
    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
    if (manifest.sha256 !== digest) throw new Error('Backup checksum does not match its manifest.');
  }
  if (expectedSha256 && digest !== expectedSha256) throw new Error('Backup checksum does not match the expected digest.');
  const check = new DatabaseSync(backup, { readOnly: true });
  try {
    const result = Object.values(check.prepare('PRAGMA quick_check').get())[0];
    if (result !== 'ok') throw new Error(`SQLite quick_check returned ${result}`);
  } finally { check.close(); }
  if (fs.existsSync(destination) && !force) throw new Error('Destination exists. Pass --force only during a controlled maintenance window.');
  fs.mkdirSync(path.dirname(destination), { recursive: true });
  const temporary = `${destination}.restore-${process.pid}-${Date.now()}`;
  fs.copyFileSync(backup, temporary, fs.constants.COPYFILE_EXCL);
  fs.chmodSync(temporary, 0o600);
  fs.renameSync(temporary, destination);
  return { ok: true, backup, destination, sha256: digest, restoredAt: new Date().toISOString() };
}
function sha256(file) { return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex'); }
if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(new URL(import.meta.url).pathname)) {
  const [backup, destination, ...flags] = process.argv.slice(2);
  if (!backup || !destination) { console.error('Usage: node scripts/restore-database-backup.mjs <backup.sqlite> <destination.sqlite> [--force]'); process.exit(1); }
  try { console.log(JSON.stringify(restoreDatabase(backup, destination, { force: flags.includes('--force') }), null, 2)); }
  catch (error) { console.error(`Restore failed: ${error.message}`); process.exitCode = 1; }
}
