import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { DatabaseSync } from 'node:sqlite';

const root = path.resolve(import.meta.dirname, '..');
const webhookSecret = 'whsec_billing_http_test_only';
const sessionSecret = 'billing-http-session-secret-123456789012345';

async function availablePort() {
  const server = http.createServer();
  await new Promise((resolve, reject) => server.listen(0, '127.0.0.1', resolve).once('error', reject));
  const port = server.address().port;
  await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  return port;
}

async function startServer({ billingWebhookMode = 'enabled' } = {}) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'arl-billing-http-'));
  const databasePath = path.join(directory, 'test.sqlite');
  const port = await availablePort();
  const origin = `http://127.0.0.1:${port}`;
  const child = spawn(process.execPath, ['server.js'], {
    cwd: root,
    env: {
      ...process.env,
      NODE_ENV: 'test',
      DEMO_MODE: 'true',
      PORT: String(port),
      BASE_URL: origin,
      DATABASE_PATH: databasePath,
      SESSION_SECRET: sessionSecret,
      STRIPE_SECRET_KEY: 'sk_test_billing_http_placeholder',
      STRIPE_WEBHOOK_SECRET: webhookSecret,
      BILLING_WEBHOOK_MODE: billingWebhookMode,
      ADMIN_EMAIL: 'billing-admin@example.com',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let logs = '';
  child.stdout.on('data', (chunk) => { logs += chunk; });
  child.stderr.on('data', (chunk) => { logs += chunk; });
  const deadline = Date.now() + 15000;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`${origin}/api/health`);
      if (response.ok) return { child, databasePath, origin, logs: () => logs };
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  child.kill('SIGTERM');
  throw new Error(`Billing HTTP test server did not start:\n${logs}`);
}

async function stopServer(instance) {
  if (instance.child.exitCode == null) {
    instance.child.kill('SIGTERM');
    await new Promise((resolve) => instance.child.once('exit', resolve));
  }
}

function signedHeaders(raw) {
  const timestamp = Math.floor(Date.now() / 1000);
  const signature = crypto.createHmac('sha256', webhookSecret)
    .update(`${timestamp}.${raw}`)
    .digest('hex');
  return { 'Content-Type': 'application/json', 'Stripe-Signature': `t=${timestamp},v1=${signature}` };
}

async function sendWebhook(origin, event) {
  const raw = JSON.stringify(event);
  const response = await fetch(`${origin}/api/stripe/webhook`, {
    method: 'POST',
    headers: signedHeaders(raw),
    body: raw,
  });
  const text = await response.text();
  let payload = text;
  try { payload = JSON.parse(text); } catch {}
  return { response, payload };
}

test('signed webhook HTTP outcomes are explicit and retry-safe', async () => {
  const instance = await startServer();
  try {
    const unsupported = {
      id: 'evt_http_unsupported',
      created: Math.floor(Date.now() / 1000),
      type: 'charge.refunded',
      data: { object: {} },
    };
    const ignored = await sendWebhook(instance.origin, unsupported);
    assert.equal(ignored.response.status, 200);
    assert.equal(ignored.payload.outcome, 'ignored_unsupported');

    const duplicate = await sendWebhook(instance.origin, unsupported);
    assert.equal(duplicate.response.status, 200);
    assert.equal(duplicate.payload.duplicate, true);

    const retryable = await sendWebhook(instance.origin, {
      id: 'evt_http_retryable_failure',
      created: Math.floor(Date.now() / 1000),
      type: 'invoice.payment_failed',
      data: { object: {} },
    });
    assert.equal(retryable.response.status, 500);

    const sqlite = new DatabaseSync(instance.databasePath);
    const now = new Date().toISOString();
    sqlite.prepare(`INSERT INTO stripe_events
      (id,event_type,processed_at,status,last_error,attempt_count,processing_started_at,completed_at,created_at)
      VALUES (?,?,?,'processing',NULL,1,?,NULL,?)`)
      .run('evt_http_processing', 'customer.subscription.updated', now, now, now);
    sqlite.close();
    const conflict = await sendWebhook(instance.origin, {
      id: 'evt_http_processing',
      created: Math.floor(Date.now() / 1000),
      type: 'customer.subscription.updated',
      data: { object: {} },
    });
    assert.equal(conflict.response.status, 409);

    const auditDb = new DatabaseSync(instance.databasePath);
    const ignoredRow = auditDb.prepare('SELECT * FROM stripe_events WHERE id=?').get(unsupported.id);
    const failedRow = auditDb.prepare('SELECT * FROM stripe_events WHERE id=?').get('evt_http_retryable_failure');
    auditDb.close();
    assert.equal(ignoredRow.processing_result, 'ignored_unsupported');
    assert.match(ignoredRow.ignored_reason, /charge\.refunded/);
    assert.equal(failedRow.status, 'failed');
    assert.equal(failedRow.completed_at, null);

    const csrfResponse = await fetch(`${instance.origin}/api/csrf`);
    const cookie = csrfResponse.headers.get('set-cookie').split(';')[0];
    const csrf = (await csrfResponse.json()).csrfToken;
    const unauthorized = await fetch(`${instance.origin}/api/admin/stripe-events/evt_http_processing/recover`, {
      method: 'POST',
      headers: { Cookie: cookie, 'X-CSRF-Token': csrf, 'Content-Type': 'application/json' },
      body: JSON.stringify({ reason: 'Not authorised', workerStoppedConfirmed: true }),
    });
    assert.equal(unauthorized.status, 401);

    const adminToken = 'billing-http-admin-session';
    const adminHash = crypto.createHmac('sha256', sessionSecret).update(`session:${adminToken}`).digest('hex');
    const adminDb = new DatabaseSync(instance.databasePath);
    adminDb.prepare(`INSERT INTO users (id,email,password_hash,email_verified_at,role,created_at)
      VALUES ('usr_http_admin','billing-admin@example.com','test-only',?,'superuser',?)`).run(now, now);
    adminDb.prepare(`INSERT INTO sessions
      (token_hash,user_id,expires_at,created_at,last_seen_at,authenticated_at,mfa_verified)
      VALUES (?,'usr_http_admin',?,?,?,?,1)`).run(adminHash,
        new Date(Date.now() + 86400000).toISOString(), now, now, now);
    adminDb.close();
    const adminCsrfResponse = await fetch(`${instance.origin}/api/csrf`, {
      headers: { Cookie: `arl_session=${adminToken}` },
    });
    const csrfCookies = typeof adminCsrfResponse.headers.getSetCookie === 'function'
      ? adminCsrfResponse.headers.getSetCookie()
      : [adminCsrfResponse.headers.get('set-cookie')].filter(Boolean);
    const adminCsrf = (await adminCsrfResponse.json()).csrfToken;
    const adminCookie = [`arl_session=${adminToken}`, ...csrfCookies.map((value) => value.split(';')[0])].join('; ');
    const missingReason = await fetch(`${instance.origin}/api/admin/stripe-events/evt_http_processing/recover`, {
      method: 'POST',
      headers: { Cookie: adminCookie, 'X-CSRF-Token': adminCsrf, 'Content-Type': 'application/json' },
      body: JSON.stringify({ reason: '', workerStoppedConfirmed: true }),
    });
    assert.equal(missingReason.status, 400);
    const recoveredResponse = await fetch(`${instance.origin}/api/admin/stripe-events/evt_http_processing/recover`, {
      method: 'POST',
      headers: { Cookie: adminCookie, 'X-CSRF-Token': adminCsrf, 'Content-Type': 'application/json' },
      body: JSON.stringify({ reason: 'Test worker termination confirmed', workerStoppedConfirmed: true }),
    });
    assert.equal(recoveredResponse.status, 200);
    assert.equal((await recoveredResponse.json()).event.status, 'failed');
  } finally {
    await stopServer(instance);
  }
});

test('billing maintenance mode fails closed before webhook processing', async () => {
  const instance = await startServer({ billingWebhookMode: 'maintenance' });
  try {
    const result = await sendWebhook(instance.origin, {
      id: 'evt_http_maintenance',
      created: Math.floor(Date.now() / 1000),
      type: 'charge.refunded',
      data: { object: {} },
    });
    assert.equal(result.response.status, 503);
    const sqlite = new DatabaseSync(instance.databasePath);
    const count = sqlite.prepare('SELECT COUNT(*) count FROM stripe_events').get().count;
    sqlite.close();
    assert.equal(Number(count), 0);
  } finally {
    await stopServer(instance);
  }
});
