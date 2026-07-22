import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';

const root = path.resolve(import.meta.dirname, '..');
const dbPath = path.join(root, 'data', 'smoke.sqlite');
for (const suffix of ['', '-shm', '-wal']) fs.rmSync(dbPath + suffix, { force: true });

const child = spawn(process.execPath, ['server.js'], {
  cwd: root,
  env: {
    ...process.env,
    PORT: '3210',
    BASE_URL: 'http://127.0.0.1:3210',
    DEMO_MODE: 'true',
    SESSION_SECRET: 'smoke-test-secret-12345678901234567890',
    DATABASE_PATH: dbPath,
    NODE_ENV: 'development',
    ADMIN_EMAIL: 'owner@example.com',
    SUPPORT_EMAIL: 'support@example.com',
  },
  stdio: ['ignore', 'pipe', 'pipe'],
});

let logs = '';
child.stdout.on('data', (data) => { logs += data; });
child.stderr.on('data', (data) => { logs += data; });
const cookies = new Map();
let csrfToken = '';

function cookieHeader() {
  return [...cookies].map(([key, value]) => `${key}=${value}`).join('; ');
}

function storeCookies(response) {
  const values = typeof response.headers.getSetCookie === 'function' ? response.headers.getSetCookie() : [response.headers.get('set-cookie')].filter(Boolean);
  for (const value of values) {
    const pair = value.split(';')[0];
    const index = pair.indexOf('=');
    if (index > 0) cookies.set(pair.slice(0, index), pair.slice(index + 1));
  }
}

async function wait() {
  const end = Date.now() + 8000;
  while (Date.now() < end) {
    try {
      const response = await fetch('http://127.0.0.1:3210/api/health');
      if (response.ok) return response.json();
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 150));
  }
  throw new Error(`Server failed\n${logs}`);
}

async function ensureCsrf() {
  if (csrfToken) return;
  const response = await fetch('http://127.0.0.1:3210/api/csrf', { headers: cookieHeader() ? { Cookie: cookieHeader() } : {} });
  storeCookies(response);
  csrfToken = (await response.json()).csrfToken;
}


async function anonymousRequest(route, { binary = false } = {}) {
  const response = await fetch(`http://127.0.0.1:3210${route}`);
  const type = response.headers.get('content-type') || '';
  const payload = binary ? Buffer.from(await response.arrayBuffer()) : type.includes('application/json') ? await response.json() : await response.text();
  if (!response.ok) throw new Error(payload?.error || payload || `HTTP ${response.status}`);
  return payload;
}

async function request(route, { method = 'GET', body, binary = false } = {}) {
  const upperMethod = method.toUpperCase();
  if (['POST', 'PUT', 'PATCH', 'DELETE'].includes(upperMethod)) await ensureCsrf();
  const response = await fetch(`http://127.0.0.1:3210${route}`, {
    method: upperMethod,
    headers: {
      ...(cookieHeader() ? { Cookie: cookieHeader() } : {}),
      ...(body ? { 'Content-Type': 'application/json' } : {}),
      ...(['POST', 'PUT', 'PATCH', 'DELETE'].includes(upperMethod) ? { 'X-CSRF-Token': csrfToken } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  storeCookies(response);
  const type = response.headers.get('content-type') || '';
  const payload = binary ? Buffer.from(await response.arrayBuffer()) : type.includes('application/json') ? await response.json() : await response.text();
  if (!response.ok) throw new Error(payload?.error || payload || `HTTP ${response.status}`);
  return payload;
}

try {
  const health = await wait();
  assert.equal(health.ok, true);
  assert.equal(health.version, '1.1.3');

  await request('/api/auth/register', { method: 'POST', body: { email: 'owner@example.com', password: 'secure-demo-password', termsAccepted: true } });
  const { questionnaire } = await request('/api/questionnaire');
  const answers = Object.fromEntries(questionnaire.map((question) => [question.id, question.options[2].value]));
  const made = await request('/api/assessments', { method: 'POST', body: { name: 'Autonomous Finance Agent', agentType: 'Finance agent', answers } });
  const assessmentId = made.assessment.id;
  const accessToken = made.accessToken;
  const shareToken = made.assessment.shareToken;
  assert.notEqual(accessToken, shareToken);

  const free = await request(`/api/assessments/${assessmentId}?token=${accessToken}`);
  assert.equal(free.assessment.paidTier, 'free');
  assert.equal(free.assessment.publicEnabled, false);
  assert.deepEqual(free.assessment.result.recommendations, []);

  await assert.rejects(() => anonymousRequest(`/api/assessments/${assessmentId}?token=${shareToken}`), /private/i);

  let badge = await fetch(`http://127.0.0.1:3210/badge/${shareToken}.svg`);
  assert.equal(badge.status, 404);
  await request(`/api/assessments/${assessmentId}/sharing`, { method: 'POST', body: { enabled: true } });
  badge = await fetch(`http://127.0.0.1:3210/badge/${shareToken}.svg`);
  assert.equal(badge.status, 200);
  assert.ok((await badge.text()).startsWith('<svg'));
  const shared = await request(`/api/public/${shareToken}`);
  assert.equal(shared.assessment.name, 'Autonomous Finance Agent');
  assert.equal(shared.assessment.result, undefined);
  assert.equal(shared.assessment.recommendations, undefined);

  const checkout = await request('/api/checkout', { method: 'POST', body: { productKey: 'pro_report', assessmentId } });
  const sessionId = new URL(checkout.url, 'http://example.test').searchParams.get('session_id');
  const paidStatus = await request(`/api/checkout/status?session_id=${sessionId}`);
  assert.equal(paidStatus.purchase.status, 'paid');

  const paid = await request(`/api/assessments/${assessmentId}?token=${accessToken}`);
  assert.equal(paid.assessment.paidTier, 'pro');
  assert.ok(paid.assessment.result.recommendations.length > 0);
  await assert.rejects(() => anonymousRequest(`/api/reports/${assessmentId}/pdf?token=${shareToken}`, { binary: true }), /required|private/i);
  const pdf = await request(`/api/reports/${assessmentId}/pdf?token=${accessToken}`, { binary: true });
  assert.equal(pdf.subarray(0, 8).toString(), '%PDF-1.4');
  assert.ok(pdf.length > 2000);

  const subscriptionCheckout = await request('/api/checkout', { method: 'POST', body: { productKey: 'developer_monthly' } });
  const subscriptionSessionId = new URL(subscriptionCheckout.url, 'http://example.test').searchParams.get('session_id');
  const subscriptionStatus = await request(`/api/checkout/status?session_id=${subscriptionSessionId}`);
  assert.equal(subscriptionStatus.subscription.status, 'active');

  const dashboard = await request('/api/dashboard');
  assert.equal(dashboard.stats.assessments, 1);
  const exported = await request('/api/account/export');
  assert.equal(exported.assessments.length, 1);
  assert.equal(exported.user.email, 'owner@example.com');

  const analytics = await request('/api/admin/analytics');
  assert.equal(analytics.totals.users, 1);
  assert.equal(analytics.totals.purchases, 2);
  assert.ok(Array.isArray(analytics.readiness.checks));

  const resetRequest = await request('/api/auth/password-reset/request', { method: 'POST', body: { email: 'owner@example.com' } });
  assert.ok(resetRequest.demoResetUrl);

  await request('/api/subscriptions/demo-cancel', { method: 'POST', body: {} });
  await request('/api/account/password', { method: 'POST', body: { currentPassword: 'secure-demo-password', newPassword: 'another-secure-demo-password' } });
  const afterPassword = await request('/api/dashboard');
  assert.equal(afterPassword.user.email, 'owner@example.com');
  await request('/api/account/delete', { method: 'POST', body: { password: 'another-secure-demo-password', confirmation: 'DELETE' } });
  await assert.rejects(() => request('/api/dashboard'), /Sign in required/);

  console.log(JSON.stringify({
    health: health.ok,
    version: health.version,
    score: made.assessment.score,
    riskBand: made.assessment.riskBand,
    paidTier: paid.assessment.paidTier,
    pdfBytes: pdf.length,
    subscription: subscriptionStatus.subscription.status,
    sharing: true,
    publicTokenIsolation: true,
    dataExport: true,
    passwordRecovery: true,
    accountDeletion: true,
    analytics: analytics.totals,
  }, null, 2));
} finally {
  child.kill('SIGTERM');
  await new Promise((resolve) => setTimeout(resolve, 300));
  for (const suffix of ['', '-shm', '-wal']) fs.rmSync(dbPath + suffix, { force: true });
}
