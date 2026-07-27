import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
const root = path.resolve(import.meta.dirname, '..');
const dbPath = path.join(root, 'data', `csrf-origin-${process.pid}.sqlite`);
for (const suffix of ['', '-shm', '-wal']) fs.rmSync(dbPath + suffix, { force: true });
process.env.DATABASE_PATH = dbPath;
process.env.NODE_ENV = 'test';
process.env.BASE_URL = 'https://agentrisklayer.com';
process.env.SESSION_SECRET = 'csrf-origin-secret-123456789012345678901';
const { db } = await import('../src/db.js');
const { issueCsrfToken, verifyCsrf } = await import('../src/security.js');
test.after(async () => {
  try { await db.close(); } catch {}
  for (const suffix of ['', '-shm', '-wal']) fs.rmSync(dbPath + suffix, { force: true });
});
function tokenAndCookie(host) {
  const headers = new Map();
  const res = { getHeader: (key) => headers.get(key), setHeader: (key, value) => headers.set(key, value) };
  const token = issueCsrfToken({ headers: { host, 'x-forwarded-proto': 'https' }, socket: {} }, res);
  const raw = headers.get('Set-Cookie');
  return { token, cookie: String(Array.isArray(raw) ? raw[0] : raw).split(';')[0] };
}
test('CSRF accepts the canonical host and the current Render/custom host but rejects unrelated origins', () => {
  const canonical = tokenAndCookie('agentrisklayer.com');
  assert.equal(verifyCsrf({ headers: { host: 'agentrisklayer.com', origin: 'https://agentrisklayer.com', cookie: canonical.cookie, 'x-csrf-token': canonical.token, 'x-forwarded-proto': 'https' }, socket: {} }), true);
  const render = tokenAndCookie('agent-risk-layer.onrender.com');
  assert.equal(verifyCsrf({ headers: { host: 'agent-risk-layer.onrender.com', origin: 'https://agent-risk-layer.onrender.com', cookie: render.cookie, 'x-csrf-token': render.token, 'x-forwarded-proto': 'https' }, socket: {} }), true);
  assert.equal(verifyCsrf({ headers: { host: 'agentrisklayer.com', origin: 'https://attacker.example', cookie: canonical.cookie, 'x-csrf-token': canonical.token, 'x-forwarded-proto': 'https' }, socket: {} }), false);
});
