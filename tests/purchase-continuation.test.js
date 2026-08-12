import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {
  buildPostVerifyContinuation,
  parsePostVerifyContinuation,
  POST_VERIFY_CONTINUATION_TTL_MS,
  targetForContinuation,
} from '../public/purchase-continuation.js';

const root = path.resolve(import.meta.dirname, '..');
const read = (name) => fs.readFileSync(path.join(root, name), 'utf8');
const origin = 'https://agentrisklayer.com';

test('assessment purchase continuation stores only a non-secret assessment identifier', () => {
  const now = 1_700_000_000_000;
  const continuation = buildPostVerifyContinuation({
    claimAssessmentId: 'asm_123',
    next: '/result.html?id=asm_123&token=secret-access-token',
    origin,
    now,
  });
  assert.deepEqual(continuation, {
    kind: 'assessment',
    assessmentId: 'asm_123',
    expiresAt: now + POST_VERIFY_CONTINUATION_TTL_MS,
  });
  assert.doesNotMatch(JSON.stringify(continuation), /secret-access-token/);
});

test('path continuation remains same-origin and drops query parameters before storage', () => {
  const now = 1_700_000_000_000;
  assert.deepEqual(buildPostVerifyContinuation({
    claimAssessmentId: '',
    next: '/pricing.html?product=developer_monthly#plans',
    origin,
    now,
  }), {
    kind: 'path',
    path: '/pricing.html#plans',
    expiresAt: now + POST_VERIFY_CONTINUATION_TTL_MS,
  });
  assert.equal(buildPostVerifyContinuation({
    claimAssessmentId: '',
    next: 'https://attacker.example/steal',
    origin,
    now,
  }), null);
});

test('stored continuation expires and rejects unsafe paths', () => {
  const now = 1_700_000_000_000;
  assert.equal(parsePostVerifyContinuation(JSON.stringify({
    kind: 'path', path: '/pricing.html', expiresAt: now - 1,
  }), { origin, now }), null);
  assert.equal(parsePostVerifyContinuation(JSON.stringify({
    kind: 'path', path: '//attacker.example', expiresAt: now + 1000,
  }), { origin, now }), null);
  assert.equal(parsePostVerifyContinuation('{bad json', { origin, now }), null);
});

test('verified assessment continuation rebuilds the result URL from server-owned assessment data', () => {
  const target = targetForContinuation(
    { kind: 'assessment', assessmentId: 'asm_123' },
    [{ id: 'asm_123', access_token: 'server-owned-token' }],
  );
  assert.equal(target, '/result.html?id=asm_123&token=server-owned-token');
  assert.equal(targetForContinuation({ kind: 'assessment', assessmentId: 'asm_missing' }, []), '/dashboard.html');
  assert.equal(targetForContinuation({ kind: 'path', path: '/pricing.html#plans' }), '/pricing.html#plans');
});

test('registration and verification preserve purchase intent instead of forcing the dashboard', () => {
  const authPage = read('public/auth-page.js');
  const verify = read('public/verify.js');
  assert.match(authPage, /rememberPostVerifyContinuation\(\)/);
  assert.match(authPage, /showVerificationWait\(\)/);
  assert.match(authPage, /I have verified my email/);
  assert.doesNotMatch(authPage, /location\.href = ['"]\/dashboard\.html\?welcome=1['"]/);
  assert.match(verify, /api\('\/api\/dashboard'\)/);
  assert.match(verify, /Continue assessment purchase/);
  assert.match(verify, /clearContinuation\(\)/);
});
