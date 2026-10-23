import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { test } from 'node:test';
import {
  checkedEndpoint, parseExternalManifest, pinnedPublicAddress,
  validateExternalRoe, runExternalAssessment
} from '../src/agent/external-agent-assessment.mjs';

const now = Date.parse('2026-10-23T18:00:00Z');
const m = {
  schema: 'arl.external-agent-manifest.v1',
  target: { name: 'Authorised synthetic agent', owner: 'Test Owner',
    endpoint: 'https://agent.customer.example.org/v1/chat', version: 'sandbox-build-17' },
  probes: [{ id: 'PROBE_001', controlIds: ['ARL-KB-032', 'ARL-KB-065'],
    body: { message: 'Benign synthetic test only' } }]
};
const raw = JSON.stringify(m);
const roe = {
  schema: 'arl.external-agent-roe.v1',
  manifestSha256: createHash('sha256').update(raw).digest('hex'),
  targetEndpoint: m.target.endpoint, operator: 'Test Operator', owner: 'Test Owner',
  environment: 'isolated-staging', syntheticDataOnly: true,
  authorisationReference: 'Written owner ROE #123',
  notBeforeUtc: '2026-10-23T17:00:00Z', notAfterUtc: '2026-10-23T19:00:00Z',
  allowedProbeIds: ['PROBE_001']
};

const args = { manifestRaw: raw, roeRaw: JSON.stringify(roe),
  operator: 'Test Operator', acknowledged: true, now: () => now };

test('manifest accepted with declared non-Git version and supported controls', () => {
  const x = parseExternalManifest(raw);
  assert.equal(x.manifest.target.version, 'sandbox-build-17');
  assert.equal(x.manifest.probes.length, 1);
});

test('blocks local, IP, credential, non-HTTPS and custom-port endpoints', () => {
  for (const value of [
    'http://public.example.org/api', 'https://127.0.0.1/api',
    'https://localhost/api', 'https://agent.internal/api',
    'https://agent.example.org:8443/api',
    'https://admin:token@agent.example.org/api',
    'https://agent.example.org/api?token=secret'
  ]) assert.throws(() => checkedEndpoint(value));
});

test('refuses DNS that resolves to any internal or reserved IP; pins permitted public IP', async () => {
  const url = checkedEndpoint(m.target.endpoint);
  await assert.rejects(pinnedPublicAddress(url, async () => ['8.8.8.8', '127.0.0.1']));
  await assert.rejects(pinnedPublicAddress(url, async () => ['169.254.169.254']));
  await assert.rejects(pinnedPublicAddress(url, async () => []));
  assert.equal(await pinnedPublicAddress(url, async () => ['8.8.8.8']), '8.8.8.8');
});

test('must have bound written ROE, matching operator, synthetic staging and valid window', () => {
  const p = parseExternalManifest(raw);
  assert.throws(() => validateExternalRoe(JSON.stringify(roe), p, 'Test Operator', false, now));
  assert.throws(() => validateExternalRoe(JSON.stringify(roe), p, 'Other Person', true, now));
  assert.throws(() => validateExternalRoe(JSON.stringify({ ...roe, manifestSha256: '0'.repeat(64) }), p, 'Test Operator', true, now));
  assert.throws(() => validateExternalRoe(JSON.stringify({ ...roe, allowedProbeIds: [] }), p, 'Test Operator', true, now));
  assert.throws(() => validateExternalRoe(JSON.stringify({ ...roe, environment: 'production' }), p, 'Test Operator', true, now));
  assert.throws(() => validateExternalRoe(JSON.stringify(roe), p, 'Test Operator', true, now + 7200000));
});

test('unauthorised call never invokes transport', async () => {
  let calls = 0;
  await assert.rejects(runExternalAssessment({ ...args, acknowledged: false,
    send: async () => { calls++; return { status: 200, body: Buffer.from('{}') }; } }));
  assert.equal(calls, 0);
});

test('accepted bounded probe records private-safe observations without inventing a PASS', async () => {
  let calls = 0;
  const result = await runExternalAssessment({ ...args,
    send: async ({ endpoint, bodyBytes }) => {
      calls++;
      assert.equal(endpoint.hostname, 'agent.customer.example.org');
      assert.equal(JSON.parse(bodyBytes).message, 'Benign synthetic test only');
      return { status: 200, body: Buffer.from('{"reply":"safe synthetic response"}') };
    }
  });
  assert.equal(calls, 1);
  assert.equal(result.observations[0].httpStatus, 200);
  assert.match(result.observations[0].responseSha256, /^[a-f0-9]{64}$/);
  assert.equal(result.observations[0].outcome, 'unreviewed');
  assert.equal(result.findingsConfirmed, 0);
  assert.equal(result.securityVerdict, 'none');
  assert.equal(result.deploymentDecision, 'hold');
  assert.doesNotMatch(JSON.stringify(result), /safe synthetic response/);
});

test('redirect and network failure cannot become PASS; no automatic redirect following', async () => {
  const redirected = await runExternalAssessment({ ...args,
    send: async () => ({ status: 302, body: Buffer.from('redirect') }) });
  assert.equal(redirected.observations[0].redirectNotFollowed, true);
  assert.equal(redirected.observations[0].outcome, 'unreviewed');
  const failed = await runExternalAssessment({ ...args,
    send: async () => { throw new Error('Sensitive network detail'); } });
  assert.equal(failed.observations[0].transport, 'network_error_or_response_rejected');
  assert.doesNotMatch(JSON.stringify(failed), /Sensitive network detail/);
});
