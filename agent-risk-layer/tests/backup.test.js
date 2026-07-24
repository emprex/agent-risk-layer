import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { backupDatabase, verifyBackup } from '../scripts/backup-database.mjs';
import { restoreDatabase } from '../scripts/restore-database-backup.mjs';

test('database backup and restore are consistent and independently readable', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'arl-backup-'));
  try {
    const source = path.join(dir, 'source.sqlite');
    const backup = path.join(dir, 'backup.sqlite');
    const restoredPath = path.join(dir, 'restored.sqlite');
    const db = new DatabaseSync(source);
    db.exec('CREATE TABLE evidence(id TEXT PRIMARY KEY, value TEXT);');
    db.prepare('INSERT INTO evidence VALUES (?,?)').run('one', 'verified');
    db.close();

    const manifest = backupDatabase(source, backup);
    assert.equal(manifest.quickCheck, 'ok');
    assert.equal(manifest.tableCounts.evidence, 1);
    assert.equal(verifyBackup(backup).quickCheck, 'ok');

    const restore = restoreDatabase(backup, restoredPath, { expectedSha256: manifest.sha256 });
    assert.equal(restore.ok, true);
    const restored = new DatabaseSync(restoredPath, { readOnly: true });
    assert.equal(restored.prepare('SELECT value FROM evidence WHERE id=?').get('one').value, 'verified');
    restored.close();
    assert.ok(fs.existsSync(`${backup}.manifest.json`));
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('restore rejects a backup that no longer matches its manifest', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'arl-backup-tamper-'));
  try {
    const source = path.join(dir, 'source.sqlite');
    const backup = path.join(dir, 'backup.sqlite');
    const destination = path.join(dir, 'destination.sqlite');
    const db = new DatabaseSync(source);
    db.exec('CREATE TABLE evidence(id TEXT PRIMARY KEY); INSERT INTO evidence VALUES (\'one\');');
    db.close();
    backupDatabase(source, backup);
    fs.appendFileSync(backup, Buffer.from([0]));
    assert.throws(() => restoreDatabase(backup, destination), /checksum does not match/i);
    assert.equal(fs.existsSync(destination), false);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
