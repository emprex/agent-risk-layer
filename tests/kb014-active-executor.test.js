import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

import { executeKb014NativeLifecycleProbe, KB014_CASES } from '../src/agent/kb014-active-executor.mjs';
import { verifyLocalTargetAdapter } from '../src/agent/local-target-adapter-gate.mjs';

const REV = 'b3116fcfcec3bf6967773c3e9587c502b1fed5e5';
const SNAP = 'sys_synthetic_001';
const base = {
  origin: 'http://127.0.0.1:8787', token: 'synthetic-local-adapter-auth',
  targetRevision: REV, snapshotId: SNAP
};

function response(caseId, state, overrides = {}) {
  return { ok: true, json: async () => ({ structuredOutput: {
    schema: 'arl.kb014.credential-lifecycle-observation.v1',
    controlId: 'ARL-KB-014', caseId, targetRevision: REV,
    systemSnapshotId: SNAP,
    targetObserved: true, dryRun: true, syntheticOnly: true,
    fixtureOnly: true, nativeTokenStoreObserved: true,
    receivingPolicyObserved: false, inventoryReconciled: false,
    state, ownerAttributed: state === 'active_cached' || state === 'expired_cached',
    expiryPresent: state === 'active_cached' || state === 'expired_cached',
    expiredByTargetCheck: state === 'expired_cached' ? true
      : state === 'absent' ? null : false,
    credentialReference: 'synthetic:' + caseId.replace('KB014-', '').toLowerCase(),
    ...overrides
  }}) };
}

test('four native synthetic lifecycle probes never grant a security verdict', async () => {
  let index = 0;
  const result = await executeKb014NativeLifecycleProbe({...base, fetchImpl: async (_url, request) => {
    assert.equal(request.method, 'POST');
    assert.equal(request.redirect, 'error');
    const payload = JSON.parse(request.body);
    assert.equal(payload.targetRevision, REV);
    assert.equal(payload.syntheticContext.dryRun, true);
    assert.equal(payload.syntheticContext.credentials, 'synthetic-only');
    const [caseName, state] = KB014_CASES[index++];
    assert.equal(payload.caseId, 'KB014-' + caseName);
    return response(payload.caseId, state);
  }});
  assert.equal(index, 4);
  assert.equal(result.status, 'native_lifecycle_fixture_integration_only');
  assert.equal(result.automaticPass, false);
  assert.equal(result.humanReviewRequired, true);
  assert.equal(result.receivingServiceAuthorizationTested, false);
  assert.equal(result.approvedInventoryReconciled, false);
  assert.equal(result.observations.length, 4);
});

test('adapter unsupported or missing provenance does not assert any verdict', async () => {
  const blocked = await executeKb014NativeLifecycleProbe({...base, fetchImpl: async () => ({ ok: false, status: 400 })});
  assert.equal(blocked.status, 'blocked');
  assert.equal(blocked.observations.length, 0);
  const missing = await executeKb014NativeLifecycleProbe({...base, fetchImpl: async () => response('KB014-CREDENTIAL-ACTIVE', 'active_cached', { nativeTokenStoreObserved: false })});
  assert.equal(missing.status, 'inconclusive');
  assert.equal(missing.automaticPass, false);
});

test('native lifecycle mismatches stay review candidates, not confirmed findings', async () => {
  let index = 0;
  const out = await executeKb014NativeLifecycleProbe({...base, fetchImpl: async () => {
    const [caseName, state] = KB014_CASES[index++];
    return response('KB014-' + caseName, state === 'absent' ? 'active_cached' : state);
  }});
  assert.equal(out.status, 'native_lifecycle_behavior_mismatch_review_required');
  assert.equal(out.automaticPass, false);
});

test('non-loopback, stale target or missing auth is rejected before executing', async () => {
  await assert.rejects(executeKb014NativeLifecycleProbe({...base, origin: 'https://example.org'}));
  await assert.rejects(executeKb014NativeLifecycleProbe({...base, targetRevision: 'not-a-sha'}));
  await assert.rejects(executeKb014NativeLifecycleProbe({...base, token: ''}));
});

test('adapter health rejects unsupported KB014 capabilities without active requests', async () => {
  let called = 0;
  const result = await verifyLocalTargetAdapter({
    repositoryPath: '/home/synthetic/arl-target-mcp-agent',
    expectedRevision: REV,
    requiredCases: KB014_CASES.map(([name]) => 'KB014-' + name),
    fetchImpl: async () => {
      called++;
      return { ok: true, json: async () => ({
        ok: true, target: 'arl-target-mcp-agent',
        revision: REV, mode: 'synthetic-dry-run',
        supportedCases: ['KB027-KEY-ALLOW']
      }) };
    }
  });
  assert.equal(called, 1);
  assert.equal(result.available, false);
  assert.equal(result.reason, 'local_adapter_required_cases_unavailable');
  assert.equal(result.missingCases.length, 4);
});

test('local KB014 owner-authorised command checks control, snapshot, ROE and adapter cases', () => {
  const workflow = fs.readFileSync(new URL('../src/agent/local-assessment-workflow.mjs', import.meta.url), 'utf8');
  const adapter = fs.readFileSync(new URL('../redteam/mcp-agent-local-adapter.py', import.meta.url), 'utf8');
  assert.match(workflow, /Authorise KB-014 synthetic active test/);
  assert.match(workflow, /Execute KB-014 synthetic active test/);
  assert.match(workflow, /ARL-CHK-014/);
  assert.match(workflow, /executeKb014NativeLifecycleProbe/);
  assert.match(workflow, /requiredCases:KB014_CASES/);
  assert.match(workflow, /verificationScope:'explicit_active_control_test_authorisation'/);
  assert.match(adapter, /from mcp_agent\.oauth\.records import TokenRecord/);
  assert.match(adapter, /from mcp_agent\.oauth\.store\.in_memory import InMemoryTokenStore/);
  assert.match(adapter, /nativeTokenStoreObserved/);
  assert.match(adapter, /"fixtureOnly": True/);
  assert.match(adapter, /"receivingPolicyObserved": False/);
});
