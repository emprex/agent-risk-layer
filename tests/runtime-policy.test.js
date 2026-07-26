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

test('blocks secret-like fields', () => {
  const result = evaluateRuntimeAction({ tool:'search', arguments:{ apiKey:'sk_test_1234567890' } }, policy);
  assert.equal(result.decision, 'deny');
  assert.ok(result.reasons.some((item) => item.ruleId === 'ARL-RUN-008'));
});

test('requires explicit approval for material actions', () => {
  assert.equal(evaluateRuntimeAction({ tool:'send_email', arguments:{ to:'person@example.com' } }, policy).decision, 'deny');
  assert.equal(evaluateRuntimeAction({ tool:'send_email', arguments:{ to:'person@example.com' }, context:{ humanApproved:true } }, policy).decision, 'allow');
});

test('monitor mode records would-deny but does not block', () => {
  const monitor = compileRuntimePolicy({ version:'monitor', mode:'monitor', deniedTools:['shell'] });
  const result = evaluateRuntimeAction({ tool:'shell', arguments:{} }, monitor);
  assert.equal(result.decision, 'allow');
  assert.equal(result.observedDecision, 'would-deny');
});

test('production actions require separate production approval', () => {
  const result = evaluateRuntimeAction({ tool:'search', arguments:{}, context:{ environment:'production' } }, policy);
  assert.equal(result.decision, 'deny');
  assert.ok(result.reasons.some((item) => item.ruleId === 'ARL-RUN-010'));
});
