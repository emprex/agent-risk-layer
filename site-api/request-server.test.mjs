import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequestServer } from './request-server.mjs';

const ORIGIN = 'https://agentrisklayer.com';
const FIELDS = {
  name: 'Example Buyer',
  company: 'Example Ltd',
  email: 'buyer@example.org',
  systemName: 'MCP Agent',
  useCase: 'It reads records.',
  access: 'It uses one authorised API.',
  concern: 'Check tool permissions.'
};

async function withServer(env, deliver, check) {
  const server = createRequestServer({ env, deliver, now: () => 1700000000000 });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  try { await check('http://127.0.0.1:' + address.port); }
  finally { await new Promise(resolve => server.close(resolve)); }
}

function submit(base, fields = FIELDS, origin = ORIGIN) {
  return fetch(base + '/api/assessment-request', {
    method: 'POST',
    headers: { Origin: origin, 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
    body: new URLSearchParams(fields)
  });
}

test('unconfigured service is fail-closed and never calls Resend', async () => {
  let sent = 0;
  await withServer({}, async () => { sent++; }, async base => {
    assert.equal((await fetch(base + '/health')).status, 503);
    assert.equal((await submit(base)).status, 503);
    assert.equal(sent, 0);
  });
});

test('valid enquiry sends text-only to exactly one owned support inbox', async () => {
  let seen = null;
  await withServer({ RESEND_API_KEY: 're_fake_unit_test' }, async (url, opts) => {
    seen = { url, opts };
    return { ok: true, status: 200 };
  }, async base => {
    assert.equal((await fetch(base + '/health')).status, 200);
    const response = await submit(base);
    assert.equal(response.status, 202);
    assert.match((await response.json()).message, /Request accepted/);
  });
  assert.equal(seen.url, 'https://api.resend.com/emails');
  assert.equal(seen.opts.headers.Authorization, 'Bearer re_fake_unit_test');
  const body = JSON.parse(seen.opts.body);
  assert.deepEqual(body.to, ['support@agentrisklayer.com']);
  assert.deepEqual(body.reply_to, ['buyer@example.org']);
  assert.match(body.text, /MCP Agent/);
  assert.equal('html' in body, false);
});

test('foreign origins, malformed form and excessive values are rejected', async () => {
  let sends = 0;
  await withServer({ RESEND_API_KEY: 're_fake_unit_test' }, async () => { sends++; return {ok:true}; }, async base => {
    assert.equal((await submit(base, FIELDS, 'https://attacker.example')).status, 403);
    assert.equal((await submit(base, { ...FIELDS, email: 'invalid' })).status, 400);
    assert.equal((await submit(base, { ...FIELDS, company: 'A'.repeat(161) })).status, 400);
    assert.equal((await submit(base, { ...FIELDS, name: 'Bad\r\nInjected' })).status, 400);
    assert.equal((await fetch(base + '/api/assessment-request', {
      method: 'POST', headers: { Origin: ORIGIN, 'Content-Type': 'text/plain' }, body: 'test'
    })).status, 400);
  });
  assert.equal(sends, 0);
});

test('honeypot silently absorbs spam; failed Resend delivery never claims acceptance', async () => {
  let sends = 0;
  await withServer({ RESEND_API_KEY: 're_fake_unit_test' }, async () => {
    sends++;
    return { ok: false, status: 403 };
  }, async base => {
    assert.equal((await submit(base, { ...FIELDS, website: 'example.biz' })).status, 202);
    assert.equal((await submit(base)).status, 502);
  });
  assert.equal(sends, 1);
});

test('bounded per-client submissions and preflight', async () => {
  let sent = 0;
  await withServer({ RESEND_API_KEY: 're_fake_unit_test' }, async () => {
    sent++;
    return { ok: true, status: 200 };
  }, async base => {
    const preflight = await fetch(base + '/api/assessment-request', {
      method: 'OPTIONS', headers: { Origin: ORIGIN, 'Access-Control-Request-Method': 'POST' }
    });
    assert.equal(preflight.status, 204);
    for (let i = 0; i < 5; i++) assert.equal((await submit(base)).status, 202);
    assert.equal((await submit(base)).status, 429);
  });
  assert.equal(sent, 5);
});
