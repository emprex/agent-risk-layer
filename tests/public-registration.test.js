import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
const root = path.resolve(import.meta.dirname, '..');
const dbPath = path.join(root, 'data', `public-registration-${process.pid}.sqlite`);
for (const suffix of ['', '-shm', '-wal']) fs.rmSync(dbPath + suffix, { force: true });
process.env.DATABASE_PATH = dbPath;
process.env.NODE_ENV = 'test';
process.env.SESSION_SECRET = 'public-registration-secret-123456789012345';
process.env.ADMIN_EMAIL = 'owner@example.com';
const { db } = await import('../src/db.js');
const { registerUser } = await import('../src/auth.js');
test.after(async () => {
  try { await db.close(); } catch {}
  for (const suffix of ['', '-shm', '-wal']) fs.rmSync(dbPath + suffix, { force: true });
});
test('ordinary users can register securely without an invitation through the public signup path', async () => {
  const user = await registerUser('new-user@example.com', 'Strong-public-password-42', true);
  assert.equal(user.email, 'new-user@example.com');
  assert.equal(user.role, 'user');
  assert.equal((await db.prepare('SELECT COUNT(*) count FROM users WHERE email=?').get(user.email)).count, 1);
});
