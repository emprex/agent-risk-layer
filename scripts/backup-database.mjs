#!/usr/bin/env node
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

export function backupDatabase(databaseUrl, destinationPath, { spawn = spawnSync, now = new Date() } = {}) {
  assertPostgresUrl(databaseUrl);
  const destination = path.resolve(destinationPath);
  if (fs.existsSync(destination)) throw new Error(`Refusing to overwrite existing backup: ${destination}`);
  fs.mkdirSync(path.dirname(destination), { recursive: true, mode: 0o700 });
  const result = spawn('pg_dump', [
    '--format=custom', '--compress=9', '--no-owner', '--no-privileges',
    '--file', destination,
  ], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, PGDATABASE: databaseUrl } });
  assertCommand(result, 'pg_dump');
  if (!fs.existsSync(destination) || fs.statSync(destination).size < 1) throw new Error('pg_dump did not create a backup archive.');
  fs.chmodSync(destination, 0o600);
  const verification = verifyBackup(destination, { spawn });
  const manifest = {
    schema: 'arl.postgresql.backup.v1',
    format: 'postgresql-custom',
    source: redactDatabaseUrl(databaseUrl),
    archive: path.basename(destination),
    createdAt: now.toISOString(),
    bytes: fs.statSync(destination).size,
    sha256: sha256File(destination),
    archiveEntries: verification.archiveEntries,
    verified: true,
  };
  const manifestPath = `${destination}.manifest.json`;
  fs.writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, { mode: 0o600 });
  return { ...manifest, destination, manifestPath };
}

export function verifyBackup(filePath, { spawn = spawnSync, expectedSha256 = null } = {}) {
  const file = path.resolve(filePath);
  if (!fs.existsSync(file)) throw new Error(`Backup not found: ${file}`);
  const digest = sha256File(file);
  const manifestPath = `${file}.manifest.json`;
  let manifest = null;
  if (fs.existsSync(manifestPath)) {
    manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
    if (manifest.schema !== 'arl.postgresql.backup.v1') throw new Error('Unsupported backup manifest schema.');
    if (manifest.sha256 !== digest) throw new Error('Backup checksum does not match its manifest.');
  }
  if (expectedSha256 && digest !== expectedSha256) throw new Error('Backup checksum does not match the expected digest.');
  const result = spawn('pg_restore', ['--list', file], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  assertCommand(result, 'pg_restore --list');
  const archiveEntries = String(result.stdout || '').split(/\r?\n/).filter((line) => line && !line.startsWith(';')).length;
  if (archiveEntries < 1) throw new Error('PostgreSQL archive contains no restorable entries.');
  return { ok: true, file, sha256: digest, manifestMatches: Boolean(manifest), archiveEntries };
}

export function rotateBackups(directory, retentionDays = 30) {
  const cutoff = Date.now() - Math.max(1, Number(retentionDays)) * 86400000;
  let removed = 0;
  if (!fs.existsSync(directory)) return { removed };
  for (const name of fs.readdirSync(directory)) {
    if (!/\.dump(?:\.manifest\.json)?$/.test(name)) continue;
    const file = path.join(directory, name);
    if (fs.statSync(file).mtimeMs < cutoff) {
      fs.rmSync(file, { force: true });
      removed += 1;
    }
  }
  return { removed };
}

export function redactDatabaseUrl(value) {
  const parsed = new URL(value);
  parsed.username = parsed.username ? '***' : '';
  parsed.password = parsed.password ? '***' : '';
  return parsed.toString();
}

function assertPostgresUrl(value) {
  let parsed;
  try { parsed = new URL(String(value || '')); } catch { throw new Error('DATABASE_URL must be a valid PostgreSQL URL.'); }
  if (!['postgres:', 'postgresql:'].includes(parsed.protocol) || !parsed.hostname || !parsed.pathname.slice(1)) {
    throw new Error('DATABASE_URL must be a PostgreSQL URL with host and database name.');
  }
}
function assertCommand(result, command) {
  if (result?.error) throw new Error(`${command} failed: ${result.error.message}`);
  if (result?.status !== 0) throw new Error(`${command} failed: ${String(result?.stderr || '').trim() || `exit ${result?.status}`}`);
}
function sha256File(file) { return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex'); }

const isCli = process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url));
if (isCli) {
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const destination = process.argv[2] || `./data/backups/agent-risk-layer-${stamp}.dump`;
  try {
    const manifest = backupDatabase(process.env.DATABASE_URL, destination);
    manifest.rotation = rotateBackups(path.dirname(path.resolve(destination)), Number(process.env.BACKUP_RETENTION_DAYS || 30));
    console.log(JSON.stringify(manifest, null, 2));
  } catch (error) {
    console.error(`Backup failed: ${error.message}`);
    process.exitCode = 1;
  }
}
