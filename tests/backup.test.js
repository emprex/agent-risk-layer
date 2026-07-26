import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { backupDatabase, verifyBackup } from '../scripts/backup-database.mjs';
import { restoreDatabase } from '../scripts/restore-database-backup.mjs';

function fakePostgresTools(calls) {
  return (command, args, options = {}) => {
    calls.push({ command, args: [...args], pgDatabase: options.env?.PGDATABASE || '' });
    if (command === 'pg_dump') {
      const destination = args[args.indexOf('--file') + 1];
      fs.writeFileSync(destination, 'PGDMP\nsynthetic archive\n');
      return { status: 0, stdout: '', stderr: '' };
    }
    if (command === 'pg_restore' && args.includes('--list')) {
      return { status: 0, stdout: '; archive header\n1; 0 0 TABLE public users arl\n2; 0 0 TABLE DATA public users arl\n', stderr: '' };
    }
    if (command === 'pg_restore') return { status: 0, stdout: 'restored', stderr: '' };
    return { status: 127, stdout: '', stderr: 'unknown command' };
  };
}

test('PostgreSQL backup creates a verified archive and redacted manifest', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'arl-pg-backup-'));
  try {
    const backup = path.join(dir, 'backup.dump');
    const calls = [];
    const spawn = fakePostgresTools(calls);
    const manifest = backupDatabase('postgresql://arl:secret@db.internal:5432/agentrisklayer', backup, { spawn, now: new Date('2026-07-26T10:00:00.000Z') });
    assert.equal(manifest.schema, 'arl.postgresql.backup.v1');
    assert.equal(manifest.verified, true);
    assert.equal(manifest.archiveEntries, 2);
    assert.doesNotMatch(JSON.stringify(manifest), /secret/);
    assert.equal(verifyBackup(backup, { spawn }).manifestMatches, true);
    assert.deepEqual(calls[0].args.slice(0, 4), ['--format=custom', '--compress=9', '--no-owner', '--no-privileges']);
    assert.doesNotMatch(calls[0].args.join(' '), /secret/);
    assert.match(calls[0].pgDatabase, /^postgresql:\/\//);
    assert.ok(fs.existsSync(`${backup}.manifest.json`));
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('restore verifies checksum, requires force, and uses atomic PostgreSQL restore flags', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'arl-pg-restore-'));
  try {
    const backup = path.join(dir, 'backup.dump');
    const calls = [];
    const spawn = fakePostgresTools(calls);
    const manifest = backupDatabase('postgresql://arl:secret@db.internal/agentrisklayer', backup, { spawn });
    assert.throws(() => restoreDatabase(backup, 'postgresql://arl:secret@restore.internal/agentrisklayer', { spawn }), /requires --force/i);
    const result = restoreDatabase(backup, 'postgresql://arl:secret@restore.internal/agentrisklayer', { spawn, force: true, expectedSha256: manifest.sha256 });
    assert.equal(result.ok, true);
    assert.doesNotMatch(result.destination, /secret/);
    const restoreCall = calls.find((call) => call.command === 'pg_restore' && !call.args.includes('--list'));
    assert.ok(restoreCall.args.includes('--single-transaction'));
    assert.ok(restoreCall.args.includes('--exit-on-error'));
    assert.doesNotMatch(restoreCall.args.join(' '), /secret/);
    assert.match(restoreCall.pgDatabase, /^postgresql:\/\//);
    fs.appendFileSync(backup, 'tampered');
    assert.throws(() => verifyBackup(backup, { spawn }), /checksum does not match/i);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
