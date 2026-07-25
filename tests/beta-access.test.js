import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

const root = path.resolve(import.meta.dirname, '..');
const dbPath = path.join(root, 'data', `beta-access-${process.pid}.sqlite`);
for (const suffix of ['', '-shm', '-wal']) fs.rmSync(dbPath + suffix, { force: true });
process.env.DATABASE_PATH = dbPath;
process.env.NODE_ENV = 'development';
process.env.SESSION_SECRET = 'beta-access-secret-12345678901234567890123';
process.env.ADMIN_EMAIL = 'owner@example.com';
process.env.REQUIRE_BETA_INVITE = 'true';

const { db, id, nowIso } = await import('../src/db.js');
const { registerUser } = await import('../src/auth.js');

test.after(() => {
  try { db.close(); } catch {}
  for (const suffix of ['', '-shm', '-wal']) fs.rmSync(dbPath + suffix, { force: true });
});

test('configured owner is a durable superuser without consuming a beta invitation', async () => {
  const owner = await registerUser('owner@example.com', 'Owner-password-42', true);
  assert.equal(owner.role, 'superuser');
  assert.equal(owner.isSuperuser, true);
  assert.equal(db.prepare('SELECT COUNT(*) count FROM beta_invites').get().count, 0);
});

test('beta invitation is email-bound and single-use', async () => {
  const code = 'ARL-TEST-INVITATION-001';
  const codeHash = crypto.createHmac('sha256', process.env.SESSION_SECRET).update(`beta-invite:${code}`).digest('hex');
  db.prepare(`INSERT INTO beta_invites (id,code_hash,email,status,created_at,expires_at)
    VALUES (?,?,?,'active',?,?)`).run(id('inv_'), codeHash, 'beta@example.com', nowIso(), new Date(Date.now() + 86400000).toISOString());
  await assert.rejects(() => registerUser('wrong@example.com', 'Strong-password-42', true, code), /invalid, expired or assigned/);
  const user = await registerUser('beta@example.com', 'Strong-password-42', true, code);
  assert.equal(user.role, 'user');
  assert.equal(db.prepare('SELECT status FROM beta_invites WHERE code_hash=?').get(codeHash).status, 'used');
  await assert.rejects(() => registerUser('beta2@example.com', 'Strong-password-42', true, code), /invalid, expired or assigned/);
});
