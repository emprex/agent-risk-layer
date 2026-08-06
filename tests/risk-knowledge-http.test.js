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
const sessionSecret = 'risk-http-session-secret-123456789012345';

async function availablePort() {
  const server = http.createServer();
  await new Promise((resolve, reject) => server.listen(0, '127.0.0.1', resolve).once('error', reject));
  const port = server.address().port;
  await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  return port;
}

async function startServer() {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'arl-risk-http-'));
  const databasePath = path.join(directory, 'test.sqlite');
  const port = await availablePort();
  const origin = `http://127.0.0.1:${port}`;
  const child = spawn(process.execPath, ['server.js'], {
    cwd: root,
    env: { ...process.env, NODE_ENV: 'test', DEMO_MODE: 'true', PORT: String(port), HOST: '127.0.0.1', BASE_URL: origin,
      DATABASE_PATH: databasePath, SESSION_SECRET: sessionSecret, ADMIN_EMAIL: '' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let logs = '';
  child.stdout.on('data', (chunk) => { logs += chunk; });
  child.stderr.on('data', (chunk) => { logs += chunk; });
  const deadline = Date.now() + 15000;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`${origin}/api/health`);
      if (response.ok) return { child, databasePath, directory, origin, logs: () => logs };
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  child.kill('SIGTERM');
  throw new Error(`Risk knowledge HTTP server did not start:\n${logs}`);
}

async function stopServer(instance) {
  if (instance.child.exitCode == null) {
    instance.child.kill('SIGTERM');
    await new Promise((resolve) => instance.child.once('exit', resolve));
  }
  fs.rmSync(instance.directory, { recursive: true, force: true });
}

function sessionHash(token) {
  return crypto.createHmac('sha256', sessionSecret).update(`session:${token}`).digest('hex');
}

function seedAuthenticatedProject(databasePath) {
  const sqlite = new DatabaseSync(databasePath);
  sqlite.exec('PRAGMA foreign_keys=ON');
  const timestamp = new Date().toISOString();
  const userId = 'usr_risk_http';
  const workspaceId = 'wsp_risk_http';
  const projectId = 'prj_risk_http';
  const otherWorkspaceId = 'wsp_risk_other';
  const otherProjectId = 'prj_risk_other';
  sqlite.prepare('INSERT INTO users (id,email,password_hash,email_verified_at,role,created_at) VALUES (?,?,?,?,?,?)')
    .run(userId, 'risk-http@example.test', 'test-only', timestamp, 'user', timestamp);
  sqlite.prepare('INSERT INTO workspaces (id,name,created_by,created_at,updated_at) VALUES (?,?,?,?,?)')
    .run(workspaceId, 'Risk HTTP', userId, timestamp, timestamp);
  sqlite.prepare('INSERT INTO workspace_members (id,workspace_id,user_id,email,display_name,role,status,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?)')
    .run('wsm_risk_http', workspaceId, userId, 'risk-http@example.test', 'Risk tester', 'owner', 'active', timestamp, timestamp);
  sqlite.prepare(`INSERT INTO security_projects
    (id,workspace_id,billing_user_id,created_by,name,slug,environment,status,policy_json,policy_version,retention_days,created_at,updated_at)
    VALUES (?,?,?,?,?,?,'production','active','{}','1',30,?,?)`)
    .run(projectId, workspaceId, userId, userId, 'Risk agent', 'risk-agent', timestamp, timestamp);
  sqlite.prepare(`INSERT INTO project_risk_knowledge_states
    (id,workspace_id,project_id,entry_id,applicability_status,applicability_reason,evidence_state,deployment_gate,critical_gate_failed,state_reason,evidence_count,updated_at,created_at)
    VALUES (?,?,?,?, 'applicable','Project uses tools','not_assessed','review_required',0,'',0,?,?)`)
    .run('rks_risk_http', workspaceId, projectId, 'ARL-KB-053', timestamp, timestamp);

  sqlite.prepare('INSERT INTO workspaces (id,name,created_by,created_at,updated_at) VALUES (?,?,?,?,?)')
    .run(otherWorkspaceId, 'Other workspace', userId, timestamp, timestamp);
  sqlite.prepare(`INSERT INTO security_projects
    (id,workspace_id,billing_user_id,created_by,name,slug,environment,status,policy_json,policy_version,retention_days,created_at,updated_at)
    VALUES (?,?,?,?,?,?,'production','active','{}','1',30,?,?)`)
    .run(otherProjectId, otherWorkspaceId, userId, userId, 'Other agent', 'other-agent', timestamp, timestamp);

  const token = crypto.randomBytes(32).toString('base64url');
  sqlite.prepare('INSERT INTO sessions (token_hash,user_id,expires_at,created_at,last_seen_at,authenticated_at,mfa_verified) VALUES (?,?,?,?,?,?,0)')
    .run(sessionHash(token), userId, new Date(Date.now() + 3600000).toISOString(), timestamp, timestamp, timestamp);
  sqlite.close();
  return { token, projectId, otherProjectId };
}

async function csrf(origin) {
  const response = await fetch(`${origin}/api/csrf`);
  const payload = await response.json();
  return { token: payload.csrfToken, cookie: response.headers.get('set-cookie').split(';')[0] };
}

test('risk knowledge HTTP routes preserve public/private boundaries and project authorization', async () => {
  const instance = await startServer();
  try {
    const libraryPage = await fetch(`${instance.origin}/risk-library.html`);
    assert.equal(libraryPage.status, 200);

    const listResponse = await fetch(`${instance.origin}/api/risk-knowledge?severity=critical&limit=250`);
    assert.equal(listResponse.status, 200);
    const list = await listResponse.json();
    assert.ok(list.entries.length > 0);
    assert.equal(list.total > list.entries.length, false);
    assert.equal(list.limit, 250);
    assert.equal(list.offset, 0);
    assert.equal(list.hasMore, false);
    assert.equal(list.entries.some((entry) => Object.hasOwn(entry, 'checks')), false);
    assert.match(listResponse.headers.get('cache-control') || '', /public/);

    const firstPage = await (await fetch(`${instance.origin}/api/risk-knowledge?limit=100`)).json();
    const lastPage = await (await fetch(`${instance.origin}/api/risk-knowledge?limit=100&offset=100`)).json();
    assert.equal(firstPage.total, 108);
    assert.equal(firstPage.hasMore, true);
    assert.deepEqual(lastPage.items.map((entry) => entry.id), ['ARL-KB-101','ARL-KB-102','ARL-KB-103','ARL-KB-104','ARL-KB-105','ARL-KB-106','ARL-KB-107','ARL-KB-108']);

    const publicDetail = await fetch(`${instance.origin}/api/risk-knowledge/ARL-KB-053`);
    assert.equal(publicDetail.status, 200);
    assert.equal(Object.hasOwn((await publicDetail.json()).entry, 'checks'), false);
    assert.equal((await fetch(`${instance.origin}/api/risk-knowledge/ARL-KB-053/detail`)).status, 401);

    const deniedProfile = await fetch(`${instance.origin}/api/risk-knowledge/profile`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ facts: { uses_tools: true } }),
    });
    assert.equal(deniedProfile.status, 403);
    const csrfState = await csrf(instance.origin);
    const profileResponse = await fetch(`${instance.origin}/api/risk-knowledge/profile`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': csrfState.token, Cookie: csrfState.cookie,
        Origin: instance.origin }, body: JSON.stringify({ facts: { uses_tools: true } }),
    });
    assert.equal(profileResponse.status, 200);
    assert.equal((await profileResponse.json()).results.length, 108);
    const invalidProfile = await fetch(`${instance.origin}/api/risk-knowledge/profile`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': csrfState.token, Cookie: csrfState.cookie,
        Origin: instance.origin }, body: JSON.stringify({ facts: { invented_fact: true } }),
    });
    assert.equal(invalidProfile.status, 400);
    assert.match((await invalidProfile.json()).error, /Unsupported architecture fact/);

    const auth = seedAuthenticatedProject(instance.databasePath);
    const authCookie = `arl_session=${encodeURIComponent(auth.token)}`;
    const detailedResponse = await fetch(`${instance.origin}/api/risk-knowledge/ARL-KB-053/detail`, { headers: { Cookie: authCookie } });
    assert.equal(detailedResponse.status, 200);
    assert.equal((await detailedResponse.json()).entry.checks.length, 1);
    const manifestResponse = await fetch(`${instance.origin}/api/risk-knowledge/ARL-KB-053/export?format=json`, { headers: { Cookie: authCookie } });
    assert.equal(manifestResponse.status, 200);
    assert.match(manifestResponse.headers.get('content-disposition') || '', /control-manifest[.]json/);
    const manifest = await manifestResponse.json();
    assert.equal(manifest.entryId, 'ARL-KB-053');
    assert.match(manifest.limitations, /not an accredited certification/i);
    const regoResponse = await fetch(`${instance.origin}/api/risk-knowledge/ARL-KB-053/export?format=rego`, { headers: { Cookie: authCookie } });
    assert.equal(regoResponse.status, 409);
    assert.match((await regoResponse.json()).error, /no verified executable rule/i);

    const readiness = await fetch(`${instance.origin}/api/projects/${auth.projectId}/risk-knowledge-readiness`, { headers: { Cookie: authCookie } });
    assert.equal(readiness.status, 200);
    assert.equal((await readiness.json()).states.length, 1);
    const other = await fetch(`${instance.origin}/api/projects/${auth.otherProjectId}/risk-knowledge-readiness`, { headers: { Cookie: authCookie } });
    assert.equal(other.status, 403);

    const authCsrf = await csrf(instance.origin);
    const writeCookie = `${authCookie}; ${authCsrf.cookie}`;
    const forbidden = await fetch(`${instance.origin}/api/projects/${auth.projectId}/risk-knowledge-profile`, {
      method: 'PUT', headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': authCsrf.token, Cookie: writeCookie, Origin: instance.origin },
      body: JSON.stringify({ facts: { uses_tools: true }, criticalGateFailed: false }),
    });
    assert.equal(forbidden.status, 400);
    const applied = await fetch(`${instance.origin}/api/projects/${auth.projectId}/risk-knowledge-profile`, {
      method: 'PUT', headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': authCsrf.token, Cookie: writeCookie, Origin: instance.origin },
      body: JSON.stringify({ facts: { uses_tools: true } }),
    });
    assert.equal(applied.status, 200);
    assert.equal((await applied.json()).results.length, 108);

    const exported = await fetch(`${instance.origin}/api/account/export`, { headers: { Cookie: authCookie } });
    assert.equal(exported.status, 200);
    const exportPayload = await exported.json();
    const exportedProject = exportPayload.projects.find((project) => project.id === auth.projectId);
    assert.ok(exportedProject);
    assert.equal(exportedProject.riskKnowledge.states.length, 108);
    assert.ok(Array.isArray(exportedProject.riskKnowledge.links));
  } finally {
    await stopServer(instance);
  }
});
