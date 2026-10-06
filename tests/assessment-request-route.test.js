import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import { spawn } from 'node:child_process';
import { once } from 'node:events';

const root = new URL('../', import.meta.url).pathname;

async function startServer(t) {
  const probe = http.createServer();
  probe.listen(0, '127.0.0.1');
  await once(probe, 'listening');
  const port = probe.address().port;
  await new Promise(resolve => probe.close(resolve));

  const db = `/tmp/arl-assessment-request-${process.pid}-${port}.sqlite`;
  const child = spawn(process.execPath, ['server.js'], {
    cwd: root,
    env: {
      ...process.env,
      NODE_ENV: 'test',
      PRODUCT_STAGE: 'development',
      DATABASE_URL: '',
      DATABASE_PATH: db,
      PORT: String(port),
      HOST: '127.0.0.1',
      DEMO_MODE: 'true',
      BASE_URL: `http://127.0.0.1:${port}`,
      RESEND_API_KEY: '',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  let logs = '';
  child.stdout.on('data', data => { logs += data; });
  child.stderr.on('data', data => { logs += data; });

  t.after(async () => {
    if (child.exitCode === null) {
      child.kill('SIGTERM');
      await once(child, 'exit');
    }
    for (const suffix of ['', '-wal', '-shm']) fs.rmSync(db + suffix, { force: true });
  });

  for (let n = 0; n < 200; n++) {
    if (logs.includes('server_started')) break;
    assert.equal(child.exitCode, null, logs);
    await new Promise(resolve => setTimeout(resolve, 50));
  }
  assert.match(logs, /server_started/);
  return { base: `http://127.0.0.1:${port}`, logs: () => logs };
}

function validRequest() {
  return {
    name: 'Security Lead',
    company: 'Example Ltd',
    email: 'security@example.com',
    systemName: 'Example Agent',
    stage: 'Pre-production',
    repository: 'https://example.invalid/repo',
    useCase: 'Agent uses bounded internal tools.',
    access: 'Staging APIs and test data.',
    concern: 'Need an evidence-backed security assessment before launch.',
  };
}

test('public assessment request route is explicit, bounded and keeps its public security contract', { timeout: 30000 }, async t => {
  const { base } = await startServer(t);
  const route = `${base}/api/assessment-request`;

  let response = await fetch(route, {
    method: 'POST',
    headers: { Origin: 'https://evil.example', 'Content-Type': 'application/json' },
    body: JSON.stringify(validRequest()),
  });
  assert.equal(response.status, 403);
  assert.deepEqual(await response.json(), { error: 'Request origin is not allowed.' });

  response = await fetch(route, { method: 'POST', body: 'x' });
  assert.equal(response.status, 415);
  assert.deepEqual(await response.json(), { error: 'JSON request required.' });

  response = await fetch(route, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: '{',
  });
  assert.equal(response.status, 400);
  assert.deepEqual(await response.json(), { error: 'Invalid JSON request.' });

  response = await fetch(route, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ...validRequest(), stage: 'Unknown' }),
  });
  assert.equal(response.status, 400);
  assert.deepEqual(await response.json(), { error: 'Please select a valid system stage.' });

  response = await fetch(route, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(validRequest()),
  });
  assert.equal(response.status, 503);
  assert.deepEqual(await response.json(), { error: 'Email delivery is not configured.' });

  response = await fetch(route, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(validRequest()),
  });
  assert.equal(response.status, 503);

  response = await fetch(route, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(validRequest()),
  });
  assert.equal(response.status, 429);
  assert.deepEqual(await response.json(), { error: 'Too many requests. Please try again later.' });
});
