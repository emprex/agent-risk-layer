import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
const dbPath = path.join(root, 'data', `redteam-quota-concurrency-${process.pid}.sqlite`);
for (const suffix of ['', '-shm', '-wal']) fs.rmSync(dbPath + suffix, { force: true });
process.env.NODE_ENV = 'test';
process.env.DATABASE_PATH = dbPath;
process.env.SESSION_SECRET = 'redteam-quota-concurrency-secret-123456789012345';
process.env.BASE_URL = 'http://localhost:3000';

const { db } = await import('../src/db.js');
const { createRedTeamToken } = await import('../src/redteam.js');

const iso = () => new Date().toISOString();
const key = (prefix) => `${prefix}${crypto.randomUUID().replaceAll('-', '')}`;

test.after(async () => {
  try { await db.close(); } catch {}
  for (const suffix of ['', '-shm', '-wal']) fs.rmSync(dbPath + suffix, { force: true });
});

async function paidAssessment(label) {
  const userId = key('usr_');
  const assessmentId = key('asm_');
  const createdAt = iso();
  await db.prepare(`INSERT INTO users
    (id,email,password_hash,terms_version,terms_accepted_at,email_verified_at,role,created_at)
    VALUES (?,?,?,?,?,?,?,?)`).run(
      userId,
      `${label}-${crypto.randomUUID()}@example.test`,
      'test-password-hash',
      'test',
      createdAt,
      createdAt,
      'user',
      createdAt,
    );
  await db.prepare(`INSERT INTO assessments
    (id,user_id,name,agent_type,answers_json,score,risk_band,result_json,paid_tier,access_token,share_token,public_enabled,scoring_version,created_at,updated_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(
      assessmentId,
      userId,
      `${label} assessment`,
      'test-agent',
      '{}',
      0,
      'Low',
      '{}',
      'pro',
      key('access_'),
      key('share_'),
      0,
      'test',
      createdAt,
      createdAt,
    );
  return { userId, assessmentId };
}

test('parallel token requests cannot oversubscribe a Professional assessment allowance', async () => {
  const { userId, assessmentId } = await paidAssessment('parallel');
  const attempts = await Promise.allSettled([
    createRedTeamToken({ userId, assessmentId }),
    createRedTeamToken({ userId, assessmentId }),
    createRedTeamToken({ userId, assessmentId }),
  ]);

  const fulfilled = attempts.filter((result) => result.status === 'fulfilled');
  const rejected = attempts.filter((result) => result.status === 'rejected');
  assert.equal(fulfilled.length, 2);
  assert.equal(rejected.length, 1);
  assert.match(rejected[0].reason.message, /allowance is used or reserved/i);

  const active = Number((await db.prepare(`SELECT COUNT(*) AS count FROM redteam_tokens
    WHERE assessment_id=? AND used_at IS NULL AND expires_at > ?`).get(assessmentId, iso())).count || 0);
  assert.equal(active, 2);
  assert.deepEqual(fulfilled.map((result) => result.value.entitlement.reserved).sort(), [1, 2]);
  assert.ok(fulfilled.every((result) => result.value.entitlement.remaining >= 0));
});

test('expired unused tokens release their reservation', async () => {
  const { userId, assessmentId } = await paidAssessment('expiry');
  await createRedTeamToken({ userId, assessmentId });
  await createRedTeamToken({ userId, assessmentId });
  await assert.rejects(
    () => createRedTeamToken({ userId, assessmentId }),
    /allowance is used or reserved/i,
  );

  await db.prepare('UPDATE redteam_tokens SET expires_at=? WHERE assessment_id=? AND used_at IS NULL')
    .run(new Date(Date.now() - 60_000).toISOString(), assessmentId);

  const replacement = await createRedTeamToken({ userId, assessmentId });
  assert.equal(replacement.entitlement.reserved, 1);
  assert.equal(replacement.entitlement.remaining, 1);
});
