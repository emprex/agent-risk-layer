import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
const dbPath = path.join(root, 'data', `auth-concurrency-${process.pid}.sqlite`);
for (const suffix of ['', '-shm', '-wal']) fs.rmSync(dbPath + suffix, { force: true });
process.env.NODE_ENV = 'test';
process.env.DATABASE_PATH = dbPath;
process.env.SESSION_SECRET = 'auth-concurrency-secret-123456789012345678901';
process.env.BASE_URL = 'http://localhost:3000';

const { db } = await import('../src/db.js');
const {
  authenticateUser,
  createEmailVerification,
  createPasswordReset,
  registerUser,
  resetPassword,
  verifyEmailToken,
} = await import('../src/auth.js');

test.after(async () => {
  try { await db.close(); } catch {}
  for (const suffix of ['', '-shm', '-wal']) fs.rmSync(dbPath + suffix, { force: true });
});

async function account(label) {
  const email = `${label}-${crypto.randomUUID()}@example.test`;
  const password = 'InitialPassword12345';
  const user = await registerUser(email, password, true);
  return { ...user, email, password };
}

test('password reset token is single-use under concurrent consumption', async () => {
  const user = await account('reset-race');
  const reset = await createPasswordReset(user.email);
  const results = await Promise.allSettled([
    resetPassword(reset.token, 'ConcurrentPassword111'),
    resetPassword(reset.token, 'ConcurrentPassword222'),
  ]);
  assert.equal(results.filter((result) => result.status === 'fulfilled').length, 1);
  assert.equal(results.filter((result) => result.status === 'rejected').length, 1);
  const firstWorks = await authenticateUser(user.email, 'ConcurrentPassword111').then(() => true, () => false);
  const secondWorks = await authenticateUser(user.email, 'ConcurrentPassword222').then(() => true, () => false);
  assert.notEqual(firstWorks, secondWorks);
});

test('email verification token is single-use under concurrent consumption', async () => {
  const user = await account('verify-race');
  const verification = await createEmailVerification(user.id);
  const results = await Promise.allSettled([
    verifyEmailToken(verification.token),
    verifyEmailToken(verification.token),
  ]);
  assert.equal(results.filter((result) => result.status === 'fulfilled').length, 1);
  assert.equal(results.filter((result) => result.status === 'rejected').length, 1);
  const row = await db.prepare('SELECT email_verified_at FROM users WHERE id=?').get(user.id);
  assert.ok(row.email_verified_at);
});
