import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';

test('runtime gateway forwards allowed calls and prevents denied calls reaching upstream', async (t) => {
  let upstreamCalls = 0;
  const upstream = http.createServer(async (req, res) => {
    upstreamCalls += 1;
    for await (const _ of req) {}
    res.writeHead(200, { 'content-type':'application/json' });
    res.end(req.url === '/leak' ? '{"answer":"token_abcd1234567890abcdef"}' : '{"upstream":true}');
  });
  await listen(upstream);
  t.after(() => upstream.close());

  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'arl-runtime-'));
  t.after(() => fs.rmSync(temp, { recursive:true, force:true }));
  const policyPath = path.join(temp, 'policy.json');
  const auditPath = path.join(temp, 'audit.jsonl');
  fs.writeFileSync(policyPath, JSON.stringify({ version:'integration', mode:'enforce', allowedTools:['search'], deniedTools:['shell'] }));
  const gatewayPort = await availablePort();
  const upstreamPort = upstream.address().port;
  const child = spawn(process.execPath, [
    'runtime/agent-risk-runtime.mjs', '--policy', policyPath,
    '--upstream', `http://127.0.0.1:${upstreamPort}`, '--port', String(gatewayPort), '--audit', auditPath,
  ], { cwd:path.resolve(import.meta.dirname, '..'), stdio:['ignore','pipe','pipe'] });
  t.after(() => child.kill('SIGTERM'));
  await waitForHealth(gatewayPort, child);

  const allowed = await fetch(`http://127.0.0.1:${gatewayPort}/tools`, {
    method:'POST', headers:{ 'content-type':'application/json', 'x-arl-tool-name':'search' }, body:'{"arguments":{"query":"safe"}}',
  });
  assert.equal(allowed.status, 200);
  assert.deepEqual(await allowed.json(), { upstream:true });
  assert.equal(upstreamCalls, 1);

  const leaked = await fetch(`http://127.0.0.1:${gatewayPort}/leak`, {
    method:'POST', headers:{ 'content-type':'application/json', 'x-arl-tool-name':'search' }, body:'{"arguments":{"query":"safe"}}',
  });
  assert.equal(leaked.status, 502);
  assert.match((await leaked.json()).error, /response blocked/i);
  assert.equal(upstreamCalls, 2, 'output inspection occurs after the upstream response and prevents delivery to the agent');

  const denied = await fetch(`http://127.0.0.1:${gatewayPort}/tools`, {
    method:'POST', headers:{ 'content-type':'application/json', 'x-arl-tool-name':'shell' }, body:'{"arguments":{"command":"id"}}',
  });
  assert.equal(denied.status, 403);
  assert.equal((await denied.json()).decision.decision, 'deny');
  assert.equal(upstreamCalls, 2, 'denied request must never reach the upstream service');

  const events = fs.readFileSync(auditPath, 'utf8').trim().split('\n').map(JSON.parse);
  const toolEvents = events.filter((event) => event.schema === 'arl.runtime.event.v1');
  const contentEvents = events.filter((event) => event.schema === 'arl.content.event.v1');
  assert.deepEqual(toolEvents.map((event) => event.decision), ['allow','allow','deny']);
  assert.equal(contentEvents.length, 5);
  assert.equal(contentEvents.filter((event) => event.direction === 'output' && event.decision === 'deny').length, 1);
  assert.ok(toolEvents.every((event) => event.evidence.rawArgumentsRetained === false));
  assert.ok(contentEvents.every((event) => event.evidence.rawContentRetained === false));
});

function listen(server) { return new Promise((resolve, reject) => server.listen(0, '127.0.0.1', resolve).once('error', reject)); }
async function availablePort() {
  const server = http.createServer();
  await listen(server);
  const port = server.address().port;
  await new Promise((resolve) => server.close(resolve));
  return port;
}
async function waitForHealth(port, child) {
  for (let index=0; index<50; index+=1) {
    if (child.exitCode !== null) throw new Error(`Gateway exited early with ${child.exitCode}.`);
    try {
      const response = await fetch(`http://127.0.0.1:${port}/health`);
      if (response.ok) return;
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error('Gateway did not become healthy.');
}
