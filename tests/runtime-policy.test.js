import test from 'node:test';
import assert from 'node:assert/strict';
import { compileRuntimePolicy, evaluateRuntimeAction } from '../src/runtime-policy.js';

const policy = compileRuntimePolicy({
  version: 'test-1',
  allowedTools: ['search', 'read_file', 'send_email'],
  allowedHosts: ['api.example.com'],
});

test('allows a narrow allowlisted read action without retaining arguments', () => {
  const result = evaluateRuntimeAction({ tool:'read_file', arguments:{ path:'/workspace/public/readme.md' } }, policy);
  assert.equal(result.decision, 'allow');
  assert.equal(result.evidence.rawArgumentsRetained, false);
  assert.match(result.evidence.argumentDigest, /^[a-f0-9]{64}$/);
});

test('blocks denied tools even when their names are namespaced', () => {
  const result = evaluateRuntimeAction({ tool:'mcp.shell', arguments:{ command:'pwd' } }, policy);
  assert.equal(result.decision, 'deny');
  assert.ok(result.reasons.some((item) => item.ruleId === 'ARL-RUN-002'));
});

test('blocks traversal and sensitive filesystem targets', () => {
  for (const path of ['../../etc/passwd', '/root/.ssh/id_ed25519', '/app/.env']) {
    assert.equal(evaluateRuntimeAction({ tool:'read_file', arguments:{ path } }, policy).decision, 'deny');
  }
});

test('blocks destinations outside the network allowlist', () => {
  const result = evaluateRuntimeAction({ tool:'search', arguments:{ url:'https://evil.example/collect' } }, policy);
  assert.equal(result.decision, 'deny');
  assert.ok(result.reasons.some((item) => item.ruleId === 'ARL-RUN-007'));
});

test('rejects a malformed configured network allowlist instead of disabling it', () => {
  assert.throws(() => compileRuntimePolicy({
    version: 'bad-hosts', allowedTools: ['search'], allowedHosts: ['%invalid-host']
  }), /Invalid allowedHosts/);
});

test('blocks malformed HTTP destinations when a network allowlist is active', () => {
  for (const url of ['https://bad%host/collect', 'https:///']) {
    const result = evaluateRuntimeAction({ tool: 'search', arguments: { url } }, policy);
    assert.equal(result.decision, 'deny', url);
    assert.ok(result.reasons.some((item) => item.ruleId === 'ARL-RUN-007'), url);
  }
});

test('malformed destinations are recorded as would-deny in monitor mode', () => {
  const monitor = compileRuntimePolicy({
    version: 'bad-host-monitor', mode: 'monitor', allowedTools: ['search'],
    allowedHosts: ['api.example.com']
  });
  const result = evaluateRuntimeAction({
    tool: 'search', arguments: { url: 'https://bad%host/collect' }
  }, monitor);
  assert.equal(result.decision, 'allow');
  assert.equal(result.observedDecision, 'would-deny');
  assert.ok(result.reasons.some((item) => item.ruleId === 'ARL-RUN-007'));
});

test('checks URL objects after serialization so a non-enumerable URL cannot evade the host allowlist', () => {
  const result = evaluateRuntimeAction({
    tool: 'search', arguments: { url: new URL('https://evil.example/collect') }
  }, policy);
  assert.equal(result.decision, 'deny');
  assert.ok(result.reasons.some((item) => item.ruleId === 'ARL-RUN-007'));
  assert.ok(result.evidence.destinations.includes('evil.example'));
});

test('checks network destinations beyond the 500-field traversal bound', () => {
  const argumentsWithManyFields = Object.fromEntries(
    Array.from({ length: 300 }, (_, i) => [`safeField${i}`, 'safe'])
  );
  argumentsWithManyFields.url = 'https://evil.example/collect';
  const result = evaluateRuntimeAction({ tool: 'search', arguments: argumentsWithManyFields }, policy);
  assert.equal(result.decision, 'deny');
  assert.ok(result.reasons.some((item) => item.ruleId === 'ARL-RUN-007'));
});

test('checks denied filesystem patterns beyond the 500-field traversal bound', () => {
  const argumentsWithManyFields = Object.fromEntries(
    Array.from({ length: 300 }, (_, i) => [`safeField${i}`, 'safe'])
  );
  argumentsWithManyFields.path = '/root/.ssh/id_ed25519';
  const result = evaluateRuntimeAction({ tool: 'read_file', arguments: argumentsWithManyFields }, policy);
  assert.equal(result.decision, 'deny');
  assert.ok(result.reasons.some((item) => item.ruleId === 'ARL-RUN-006'));
});

test('still allows a serialized URL object pointing at a permitted network destination', () => {
  const result = evaluateRuntimeAction({
    tool: 'search', arguments: { url: new URL('https://api.example.com/public') }
  }, policy);
  assert.equal(result.decision, 'allow');
  assert.ok(result.evidence.destinations.includes('api.example.com'));
});

test('blocks secret-like fields', () => {
  const result = evaluateRuntimeAction({ tool:'search', arguments:{ apiKey:'sk_test_1234567890' } }, policy);
  assert.equal(result.decision, 'deny');
  assert.ok(result.reasons.some((item) => item.ruleId === 'ARL-RUN-008'));
});

test('requires server-verified approval for material actions and ignores caller assertions', () => {
  assert.equal(evaluateRuntimeAction({ tool:'send_email', arguments:{ to:'person@example.com' } }, policy).decision, 'deny');
  assert.equal(evaluateRuntimeAction({ tool:'send_email', arguments:{ to:'person@example.com' }, context:{ humanApproved:true, productionApproved:true } }, policy).decision, 'deny');
  assert.equal(evaluateRuntimeAction({ tool:'send_email', arguments:{ to:'person@example.com' }, context:{ environment:'staging' },
    approval:{ valid:true, approvalId:'apr_1', environment:'staging' } }, policy).decision, 'allow');
});

test('monitor mode records would-deny but does not block', () => {
  const monitor = compileRuntimePolicy({ version:'monitor', mode:'monitor', deniedTools:['shell'] });
  const result = evaluateRuntimeAction({ tool:'shell', arguments:{} }, monitor);
  assert.equal(result.decision, 'allow');
  assert.equal(result.observedDecision, 'would-deny');
});

test('approval environment must match the authoritative runtime environment', () => {
  const result = evaluateRuntimeAction({ tool:'send_email', arguments:{ to:'person@example.com' }, context:{ environment:'production' },
    approval:{ valid:true, approvalId:'apr_1', environment:'staging' } }, policy);
  assert.equal(result.decision, 'deny');
  assert.ok(result.reasons.some((item) => item.ruleId === 'ARL-RUN-010'));
});
