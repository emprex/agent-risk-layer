import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import test from 'node:test';

import { buildWizardManifest, buildWizardRoe, buildLocalObservationRequest } from '../bin/arl-work.mjs';
import { validateExternalRoe } from '../src/agent/external-agent-assessment.mjs';

function validPlan() {
  return buildWizardManifest({
    name: 'Authorised pilot agent',
    owner: 'Staging owner',
    endpoint: 'https://staging.customer.example.org/api/agent',
    version: 'declared-v1',
    controlIds: ['ARL-KB-032', 'ARL-KB-065'],
    requestBody: { message: 'Synthetic harmless probe' }
  });
}

test('one-command operator builds a bounded valid external target manifest', () => {
  const { raw, parsed } = validPlan();
  assert.equal(parsed.manifest.target.name, 'Authorised pilot agent');
  assert.equal(parsed.manifest.probes.length, 1);
  assert.deepEqual(parsed.manifest.probes[0].controlIds, [
    'ARL-KB-032','ARL-KB-065'
  ]);
  assert.match(parsed.sha256, /^[0-9a-f]{64}$/);
  assert.equal(crypto.createHash('sha256').update(raw).digest('hex'), parsed.sha256);
});

test('operator refuses non-HTTPS, internal target, malformed controls or secret credentials', () => {
  const normal = {
    name: 'Authorised pilot agent',
    owner: 'Staging owner',
    endpoint: 'https://staging.customer.example.org/api/agent',
    version: 'declared-v1',
    controlIds: ['ARL-KB-032'],
    requestBody: { message: 'Safe' }
  };
  for (const patch of [
    { endpoint: 'http://example.org/api' },
    { endpoint: 'https://127.0.0.1/api' },
    { endpoint: 'https://operator:secret@staging.customer.example.org/api' },
    { controlIds: ['ARL-KB-999'] },
    { requestBody: ['not an object'] }
  ]) assert.throws(() => buildWizardManifest({ ...normal, ...patch }));
});

test('operator-produced ROE is exact-manifest scoped and valid only in the time window', () => {
  const p = validPlan();
  const now = Date.parse('2026-10-23T17:00:00Z');
  const text = buildWizardRoe({
    manifestRaw: p.raw, operator: 'Real operator',
    reference: 'SIGNED_SCOPE_1234',
    fromMs: now - 1000, untilMs: now + 360000
  });
  const checked = validateExternalRoe(
    text, p.parsed, 'Real operator', true, now
  );
  assert.equal(checked.roe.allowedProbeIds[0], 'PILOT_001');
  assert.equal(checked.roe.syntheticDataOnly, true);
  assert.equal(checked.roe.environment, 'isolated-staging');
  assert.equal(checked.roe.manifestSha256, p.parsed.sha256);
  assert.throws(() => validateExternalRoe(text, p.parsed, 'Other operator', true, now));
  assert.throws(() => validateExternalRoe(text, p.parsed, 'Real operator', true, now + 500000));
});

test('one-command operator refuses to create a live ROE without a human reference', () => {
  const { raw } = validPlan();
  assert.throws(() => buildWizardRoe({
    manifestRaw: raw, operator: 'Operator',
    reference: 'none', fromMs: Date.now(), untilMs: Date.now() + 60000
  }));
});

test('operator menu opens a visibly synthetic local workbench with no external inputs', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'arl-work-menu-'));
  const localHome = path.join(root, 'home');
  fs.mkdirSync(localHome, { mode: 0o700 });
  try {
    const result = spawnSync(process.execPath, [
      path.join('bin','arl-work.mjs')
    ], {
      cwd: path.resolve(import.meta.dirname, '..'),
      env: { ...process.env, HOME: localHome },
      encoding: 'utf8',
      input: '4\n',
      timeout: 15000
    });
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /AGENTRISKLAYER.*LOCAL OPERATOR/);
    assert.match(result.stdout, /SYNTHETIC DEMO ONLY/);
    const outputRoot = path.join(localHome, 'ARL-Assessments');
    assert.equal(fs.statSync(outputRoot).mode & 0o077, 0);
    const children = fs.readdirSync(outputRoot);
    assert.equal(children.length, 1);
    const files = fs.readdirSync(path.join(outputRoot, children[0]))
      .filter(name => name.endsWith('.html'));
    assert.equal(files.length, 1);
    const html = fs.readFileSync(path.join(outputRoot, children[0], files[0]), 'utf8');
    assert.match(html, /SYNTHETIC DEMONSTRATION/);
    assert.match(html, /Deployment HOLD/);
    assert.doesNotMatch(html, /<script\b/i);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});


test('local operator action builds existing canonical inconclusive evidence command', () => {
  const request = buildLocalObservationRequest({
    controlId: 'arl-kb-032',
    observedResult: 'Observed a denied operation in the approved staging session.',
    sourceReference: 'customer-staging-log-001'
  });
  assert.match(request, /^Record manual evidence /);
  const record = JSON.parse(request.slice('Record manual evidence '.length));
  assert.equal(record.controlId, 'ARL-KB-032');
  assert.equal(record.result, 'inconclusive');
  assert.equal(record.evidenceChecklist.length, 0);
  assert.equal(record.sourceReference, 'customer-staging-log-001');
  assert.match(record.limitations, /not independent validation/i);
  assert.throws(() => buildLocalObservationRequest({
    controlId: 'ARL-KB-999', observedResult: 'Observed denied access.',
    sourceReference: 'log-001'
  }));
  assert.throws(() => buildLocalObservationRequest({
    controlId: 'ARL-KB-032', observedResult: 'denied',
    sourceReference: 'log-001'
  }));
});
