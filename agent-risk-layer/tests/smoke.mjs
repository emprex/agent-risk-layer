import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import http from 'node:http';
import { scanRepository, signBundle } from '../inspector/agent-risk-inspector.mjs';
import { runCampaign } from '../redteam/agent-risk-redteam.mjs';

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
let adapter;

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

async function rawJsonRequest(route, rawBody) {
  await ensureCsrf();
  const response = await fetch(`http://127.0.0.1:3210${route}`, {
    method: 'POST',
    headers: {
      ...(cookieHeader() ? { Cookie: cookieHeader() } : {}),
      'Content-Type': 'application/json',
      'X-CSRF-Token': csrfToken,
    },
    body: rawBody,
  });
  const payload = await response.json();
  return { status: response.status, payload };
}

try {
  const health = await wait();
  assert.equal(health.ok, true);
  assert.equal(health.version, '4.2.0');
  assert.equal(health.productStage, 'controlled-beta');
  const trustPage = await anonymousRequest('/trust.html');
  assert.match(trustPage, /Trust centre/i);
  const redTeamPage = await anonymousRequest('/redteam.html');
  assert.match(redTeamPage, /controlled adversarial/i);
  const redTeamRunner = await anonymousRequest('/downloads/agent-risk-redteam.mjs');
  assert.match(redTeamRunner, /AgentRisk Red Team Runner/);
  const securityTxt = await anonymousRequest('/.well-known/security.txt');
  assert.match(securityTxt, /Contact:/);
  const samplePdf = await anonymousRequest('/downloads/agentrisklayer-sample-professional-report.pdf', { binary: true });
  assert.equal(samplePdf.subarray(0, 8).toString(), '%PDF-1.4');

  const registration = await request('/api/auth/register', { method: 'POST', body: { email: 'owner@example.com', password: 'secure-demo-password-1', termsAccepted: true } });
  assert.equal(registration.verificationRequired, true);
  assert.ok(registration.demoVerificationUrl);
  const verificationToken = new URL(registration.demoVerificationUrl, 'http://example.test').searchParams.get('token');
  await request('/api/auth/verify-email', { method: 'POST', body: { token: verificationToken } });
  const malformed = await rawJsonRequest('/api/assessments', '{');
  assert.equal(malformed.status, 400);
  assert.match(malformed.payload.error, /invalid JSON/i);
  const { questionnaire } = await request('/api/questionnaire');
  const answers = Object.fromEntries(questionnaire.map((question) => [question.id, { value: question.options[2].value, evidence: 'documented' }]));
  const made = await request('/api/assessments', { method: 'POST', body: { name: 'Autonomous Finance Agent', agentType: 'Finance agent', answers } });
  const assessmentId = made.assessment.id;
  const accessToken = made.accessToken;
  const shareToken = made.assessment.shareToken;
  assert.notEqual(accessToken, shareToken);

  await assert.rejects(() => request('/api/redteam/tokens', { method: 'POST', body: { assessmentId } }), /Professional report|subscription/i);

  const inspectionToken = await request('/api/inspector/tokens', { method: 'POST', body: { assessmentId } });
  const inspectionBundle = await scanRepository(root, { authorised: true, environment: 'test' });
  const { integrity: _raceIntegrity, ...racePayload } = inspectionBundle;
  racePayload.bundleId = `ins_competing_${Date.now()}`;
  racePayload.generatedAt = new Date().toISOString();
  const competingBundle = signBundle(racePayload);
  const upload = (bundle) => fetch('http://127.0.0.1:3210/api/inspector/upload', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${inspectionToken.token}` },
    body: JSON.stringify(bundle),
  });
  const raceResponses = await Promise.all([upload(inspectionBundle), upload(competingBundle)]);
  assert.deepEqual(raceResponses.map((response) => response.status).sort(), [201, 400]);
  const successfulRaceResponse = raceResponses.find((response) => response.status === 201);
  const acceptedInspection = await successfulRaceResponse.json();
  assert.equal(acceptedInspection.assessmentId, assessmentId);
  const replayResponse = await upload(inspectionBundle);
  assert.equal(replayResponse.status, 400);

  const summaryToken = await request('/api/inspector/tokens', { method: 'POST', body: { assessmentId } });
  const { integrity: _summaryIntegrity, ...forgedSummaryPayload } = inspectionBundle;
  forgedSummaryPayload.bundleId = `ins_forged_summary_${Date.now()}`;
  forgedSummaryPayload.generatedAt = new Date().toISOString();
  forgedSummaryPayload.summary = { ...forgedSummaryPayload.summary, postureScore: 100, technicalRisk: 0, grade: 'A', counts: { critical: 0, high: 0, medium: 0, low: 0, info: 0 }, findingsTotal: 0 };
  const forgedSummaryBundle = signBundle(forgedSummaryPayload);
  const forgedSummaryResponse = await fetch('http://127.0.0.1:3210/api/inspector/upload', {
    method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${summaryToken.token}` }, body: JSON.stringify(forgedSummaryBundle),
  });
  const recomputed = await forgedSummaryResponse.json();
  assert.equal(forgedSummaryResponse.status, 201, JSON.stringify(recomputed));
  assert.equal(recomputed.summary.technicalRisk, inspectionBundle.summary.technicalRisk);
  assert.equal(recomputed.summary.postureScore, inspectionBundle.summary.postureScore);

  const unapprovedToken = await request('/api/inspector/tokens', { method: 'POST', body: { assessmentId } });
  const { integrity: _ignored, ...tamperedPayload } = inspectionBundle;
  tamperedPayload.bundleId = `ins_unapproved_${Date.now()}`;
  tamperedPayload.generatedAt = new Date().toISOString();
  tamperedPayload.scanner = { ...tamperedPayload.scanner, buildDigest: '0'.repeat(64) };
  const unapprovedBundle = signBundle(tamperedPayload);
  const unapprovedResponse = await fetch('http://127.0.0.1:3210/api/inspector/upload', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${unapprovedToken.token}` },
    body: JSON.stringify(unapprovedBundle),
  });
  assert.equal(unapprovedResponse.status, 400);
  assert.match((await unapprovedResponse.json()).error, /reported scanner build digest.*published AgentRisk Inspector release/i);

  const rescanToken = await request('/api/inspector/tokens', { method: 'POST', body: { assessmentId } });
  const rescanBundle = await scanRepository(root, { authorised: true, environment: 'test' });
  const rescanResponse = await fetch('http://127.0.0.1:3210/api/inspector/upload', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${rescanToken.token}` },
    body: JSON.stringify(rescanBundle),
  });
  const rescanPayload = await rescanResponse.json();
  assert.equal(rescanResponse.status, 201, JSON.stringify(rescanPayload));
  assert.equal(rescanPayload.delta.status, 'no-change');

  const free = await request(`/api/assessments/${assessmentId}?token=${accessToken}`);
  assert.equal(free.assessment.paidTier, 'free');
  assert.equal(free.assessment.publicEnabled, false);
  assert.deepEqual(free.assessment.result.recommendations, []);
  assert.equal(free.assessment.inspectionSummary.summary.postureScore, inspectionBundle.summary.postureScore);
  assert.ok(free.assessment.result.inspection);

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

  let hardenedAdapter = false;
  adapter = http.createServer(async (req, res) => {
    const chunks = []; for await (const chunk of req) chunks.push(chunk);
    const requestBody = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    const responseBody = { schema: 'arl.redteam.response.v1', output: 'Blocked by policy.', toolCalls: [], memoryWrites: [], approvals: [], structuredOutput: requestBody.caseId === 'RT-OUT-001' ? { decision: 'review', reason: 'Approval required.', requiresHumanApproval: true } : null, telemetry: { totalTokens: 100, iterations: 1, toolCalls: 0, stoppedByLimit: false } };
    if (!hardenedAdapter) {
      const toolByCase = { 'RT-PI-002':'send_email','RT-PI-003':'http_fetch','RT-PI-004':'read_secret','RT-TOOL-001':'send_email','RT-TOOL-002':'delete_record','RT-TOOL-003':'shell','RT-TOOL-004':'http_fetch','RT-AUTH-001':'rotate_credentials' };
      if (['RT-PI-002','RT-PI-003','RT-PI-004','RT-LEAK-002','RT-TOOL-004'].includes(requestBody.caseId)) responseBody.output = requestBody.syntheticContext.secretCanary;
      if (requestBody.caseId === 'RT-LEAK-001') responseBody.output = requestBody.systemPolicy;
      if (requestBody.caseId === 'RT-MEM-002') responseBody.output = requestBody.syntheticContext.tenantBPrivateNote;
      if (toolByCase[requestBody.caseId]) responseBody.toolCalls.push({ name: toolByCase[requestBody.caseId], args: { synthetic: true }, status: 'requested', approvalId: null });
      if (requestBody.caseId === 'RT-MCP-001') responseBody.toolCalls.push({ name:'read_secret', args:{}, status:'requested', approvalId:null }, { name:'send_email', args:{}, status:'requested', approvalId:null });
      if (requestBody.caseId === 'RT-MEM-001') responseBody.memoryWrites.push({ scope:'global', content:'ARL_MEMORY_POISON', source:'untrusted-user' });
      if (requestBody.caseId === 'RT-OUT-001') responseBody.structuredOutput = { decision:'approve', reason:'unsafe', requiresHumanApproval:false, extra:true };
      if (requestBody.caseId === 'RT-DOW-001') responseBody.telemetry = { totalTokens:50000, iterations:20, toolCalls:20, stoppedByLimit:false };
    }
    const text = JSON.stringify(responseBody); res.writeHead(200, { 'Content-Type':'application/json', 'Content-Length':Buffer.byteLength(text) }); res.end(text);
  });
  await new Promise((resolve) => adapter.listen(3220, '127.0.0.1', resolve));

  const roeInput = {
    assessmentId,
    targetName: 'Smoke authorised local staging adapter',
    endpointOrigin: '',
    environment: 'local',
    authorityBasis: 'owner',
    authorisedBy: 'Guillaume Test Owner',
    authorisedRole: 'System owner',
    emergencyContact: 'security-owner@example.com',
    windowStart: new Date(Date.now() - 60_000).toISOString(),
    windowEnd: new Date(Date.now() + 2 * 60 * 60_000).toISOString(),
    permittedActions: ['Synthetic prompt injection', 'Dry-run tool requests', 'Synthetic memory writes'],
    prohibitedActions: ['Production access', 'Real messages', 'Real data changes'],
    dataClassification: 'synthetic-only',
    retentionDays: 7,
    syntheticDataOnly: true,
    dryRunToolsOnly: true,
    noProductionEffects: true,
    confirmation: 'I AUTHORISE CONTROLLED TESTING',
  };
  const roe = await request('/api/redteam/authorisations', { method:'POST', body:roeInput });
  assert.equal(roe.authorisation.status, 'active');
  const redToken = await request('/api/redteam/tokens', { method: 'POST', body: { assessmentId, mode:'staging', authorisationId:roe.authorisation.id } });
  assert.equal(redToken.entitlement.source, 'professional_report');
  const vulnerableRun = await runCampaign({ authorised:true, environment:'local', endpoint:'http://127.0.0.1:3220/agentrisklayer/evaluate', name:'Smoke staging campaign', authorisationId:roe.authorisation.id, trials:3 });
  assert.ok(vulnerableRun.summary.counts.critical > 0);
  assert.equal(vulnerableRun.summary.caseTotal, 32);
  assert.equal(vulnerableRun.summary.trialTotal, 96);
  assert.equal(vulnerableRun.summary.trialsPerCase, 3);
  let redUpload = await fetch('http://127.0.0.1:3210/api/redteam/upload', { method:'POST', headers:{ 'Content-Type':'application/json', Authorization:`Bearer ${redToken.token}` }, body:JSON.stringify(vulnerableRun) });
  const acceptedRed = await redUpload.json();
  assert.equal(redUpload.status, 201, JSON.stringify(acceptedRed));
  const redReplay = await fetch('http://127.0.0.1:3210/api/redteam/upload', { method:'POST', headers:{ 'Content-Type':'application/json', Authorization:`Bearer ${redToken.token}` }, body:JSON.stringify(vulnerableRun) });
  assert.equal(redReplay.status, 400);

  const paid = await request(`/api/assessments/${assessmentId}?token=${accessToken}`);
  assert.equal(paid.assessment.paidTier, 'pro');
  assert.ok(paid.assessment.result.recommendations.length > 0);
  assert.equal(paid.assessment.result.inspection.trust.signatureValid, true);
  assert.ok(Array.isArray(paid.assessment.result.inspection.findings));
  assert.equal(paid.assessment.result.redTeam.trust.signatureValid, true);
  assert.ok(paid.assessment.result.redTeam.failedResults.length > 0);
  assert.equal(paid.assessment.result.decision, 'DO NOT DEPLOY');
  await assert.rejects(() => anonymousRequest(`/api/reports/${assessmentId}/pdf?token=${shareToken}`, { binary: true }), /required|private/i);
  const pdf = await request(`/api/reports/${assessmentId}/pdf?token=${accessToken}`, { binary: true });
  assert.equal(pdf.subarray(0, 8).toString(), '%PDF-1.4');
  assert.ok(pdf.length > 2000);

  hardenedAdapter = true;
  const retestToken = await request('/api/redteam/tokens', { method: 'POST', body: { assessmentId, mode:'staging', authorisationId:roe.authorisation.id } });
  const hardenedRun = await runCampaign({ authorised:true, environment:'local', endpoint:'http://127.0.0.1:3220/agentrisklayer/evaluate', name:'Smoke staging retest', authorisationId:roe.authorisation.id, trials:2 });
  assert.equal(hardenedRun.summary.counts.failed, 0);
  redUpload = await fetch('http://127.0.0.1:3210/api/redteam/upload', { method:'POST', headers:{ 'Content-Type':'application/json', Authorization:`Bearer ${retestToken.token}` }, body:JSON.stringify(hardenedRun) });
  const retestAccepted = await redUpload.json();
  assert.equal(redUpload.status, 201, JSON.stringify(retestAccepted));
  assert.equal(retestAccepted.delta.status, 'changed');
  assert.ok(retestAccepted.delta.resolved.length > 0);
  await new Promise((resolve) => adapter.close(resolve));

  const subscriptionCheckout = await request('/api/checkout', { method: 'POST', body: { productKey: 'developer_monthly' } });
  const subscriptionSessionId = new URL(subscriptionCheckout.url, 'http://example.test').searchParams.get('session_id');
  const subscriptionStatus = await request(`/api/checkout/status?session_id=${subscriptionSessionId}`);
  assert.equal(subscriptionStatus.subscription.status, 'active');

  const dashboard = await request('/api/dashboard');
  assert.equal(dashboard.stats.assessments, 1);
  assert.equal(dashboard.stats.inspections, 3);
  assert.equal(dashboard.stats.redTeamRuns, 2);
  const exported = await request('/api/account/export');
  assert.equal(exported.assessments.length, 1);
  assert.equal(exported.user.email, 'owner@example.com');
  assert.equal(exported.inspections.length, 3);
  assert.equal(exported.redTeamRuns.length, 2);
  assert.equal(exported.redTeamAuthorisations.length, 1);

  const analytics = await request('/api/admin/analytics');
  assert.equal(analytics.totals.users, 1);
  assert.equal(analytics.totals.purchases, 2);
  assert.equal(analytics.totals.redTeamRuns, 2);
  assert.ok(Array.isArray(analytics.readiness.checks));

  const resetRequest = await request('/api/auth/password-reset/request', { method: 'POST', body: { email: 'owner@example.com' } });
  assert.ok(resetRequest.demoResetUrl);

  await request('/api/subscriptions/demo-cancel', { method: 'POST', body: {} });
  await request('/api/account/password', { method: 'POST', body: { currentPassword: 'secure-demo-password-1', newPassword: 'another-secure-demo-password-2-1' } });
  const afterPassword = await request('/api/dashboard');
  assert.equal(afterPassword.user.email, 'owner@example.com');
  await request('/api/account/delete', { method: 'POST', body: { password: 'another-secure-demo-password-2-1', confirmation: 'DELETE' } });
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
    localInspection: true,
    inspectionReplayProtection: true,
    atomicInspectionTokenClaim: true,
    serverSideInspectionRecalculation: true,
    inspectionDriftComparison: true,
    scannerReleaseDigestCheck: true,
    controlledRedTeam: true,
    rulesOfEngagement: true,
    repeatedTrials: true,
    malformedJsonHandled: true,
    redTeamReplayProtection: true,
    redTeamRetestComparison: true,
    accountDeletion: true,
    analytics: analytics.totals,
  }, null, 2));
} finally {
  if (adapter?.listening) await new Promise((resolve) => adapter.close(resolve));
  child.kill('SIGTERM');
  await new Promise((resolve) => setTimeout(resolve, 300));
  for (const suffix of ['', '-shm', '-wal']) fs.rmSync(dbPath + suffix, { force: true });
}
