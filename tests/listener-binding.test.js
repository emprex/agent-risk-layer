import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';

const root = path.resolve(import.meta.dirname, '..');

async function availablePort() {
  const probe = http.createServer();
  await new Promise((resolve, reject) => probe.listen(0, '127.0.0.1', resolve).once('error', reject));
  const port = probe.address().port;
  await new Promise((resolve, reject) => probe.close((error) => error ? reject(error) : resolve()));
  return port;
}

function isolatedEnvironment(directory, port, host) {
  const environment = { ...process.env };
  delete environment.DATABASE_URL;
  return {
    ...environment,
    NODE_ENV: 'test',
    DEMO_MODE: 'true',
    PORT: String(port),
    HOST: host,
    BASE_URL: `http://127.0.0.1:${port}`,
    DATABASE_PATH: path.join(directory, 'listener.sqlite'),
    SESSION_SECRET: 'listener-test-secret-12345678901234567890',
  };
}

async function stop(child) {
  if (child.exitCode !== null) return;
  child.kill('SIGTERM');
  await new Promise((resolve) => child.once('exit', resolve));
}

test('real application listener binds exclusively to configured loopback host', async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'arl-listener-'));
  const port = await availablePort();
  const child = spawn(process.execPath, ['server.js'], {
    cwd: root,
    env: isolatedEnvironment(directory, port, '127.0.0.1'),
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let output = '';
  child.stdout.on('data', (chunk) => { output += chunk; });
  child.stderr.on('data', (chunk) => { output += chunk; });
  try {
    const deadline = Date.now() + 15000;
    let response;
    while (Date.now() < deadline) {
      try {
        response = await fetch(`http://127.0.0.1:${port}/api/health`);
        if (response.ok) break;
      } catch {}
      if (child.exitCode !== null) break;
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    assert.equal(response?.status, 200, output);
    const started = output.split('\n')
      .filter(Boolean)
      .map((line) => {
        try { return JSON.parse(line); } catch { return null; }
      })
      .find((entry) => entry?.event === 'server_started');
    assert.equal(started?.bindHost, '127.0.0.1', output);
  } finally {
    await stop(child);
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test('invalid HOST fails before the application starts listening', async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'arl-listener-invalid-'));
  const port = await availablePort();
  const child = spawn(process.execPath, ['server.js'], {
    cwd: root,
    env: isolatedEnvironment(directory, port, 'http://127.0.0.1'),
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let output = '';
  child.stdout.on('data', (chunk) => { output += chunk; });
  child.stderr.on('data', (chunk) => { output += chunk; });
  try {
    const exit = await Promise.race([
      new Promise((resolve) => child.once('exit', (code, signal) => resolve({ code, signal }))),
      new Promise((_, reject) => setTimeout(() => reject(new Error('invalid-host process did not exit')), 5000)),
    ]);
    assert.notEqual(exit.code, 0);
    assert.match(output, /Invalid HOST/);
    assert.doesNotMatch(output, /"event":"server_started"/);
    const probe = http.createServer();
    await new Promise((resolve, reject) => probe.listen(port, '127.0.0.1', resolve).once('error', reject));
    await new Promise((resolve, reject) => probe.close((error) => error ? reject(error) : resolve()));
  } finally {
    await stop(child);
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test('ambiguous HOST=0 fails before startup and cannot open an all-interface listener', async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'arl-listener-ambiguous-'));
  const port = await availablePort();
  const child = spawn(process.execPath, ['server.js'], {
    cwd: root,
    env: isolatedEnvironment(directory, port, '0'),
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let output = '';
  child.stdout.on('data', (chunk) => { output += chunk; });
  child.stderr.on('data', (chunk) => { output += chunk; });
  try {
    const exit = await Promise.race([
      new Promise((resolve) => child.once('exit', (code, signal) => resolve({ code, signal }))),
      new Promise((_, reject) => setTimeout(() => reject(new Error('ambiguous-host process did not exit')), 5000)),
    ]);
    assert.notEqual(exit.code, 0);
    assert.match(output, /Invalid HOST: noncanonical numeric address syntax/);
    assert.doesNotMatch(output, /"event":"server_started"/);
    assert.equal(fs.existsSync(path.join(directory, 'listener.sqlite')), false, 'database initialisation must not complete');

    const probe = http.createServer();
    await new Promise((resolve, reject) => probe.listen(port, '127.0.0.1', resolve).once('error', reject));
    await new Promise((resolve, reject) => probe.close((error) => error ? reject(error) : resolve()));
  } finally {
    await stop(child);
    fs.rmSync(directory, { recursive: true, force: true });
  }
});
