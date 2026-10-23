import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import test from 'node:test';

import { runExternalAssessment } from '../src/agent/external-agent-assessment.mjs';
import {
  buildExternalOperatorDossier,
  renderExternalOperatorHtml,
  writeExternalOperatorHtml
} from '../src/agent/external-agent-operator-dashboard.mjs';

const date = Date.parse('2026-10-23T18:00:00.000Z');
const hash = value => crypto.createHash('sha256').update(value).digest('hex');

const manifest = JSON.stringify({
  schema: 'arl.external-agent-manifest.v1',
  target: {
    name: 'Synthetic <img src=x onerror=alert(1)> agent',
    owner: 'Synthetic staging owner',
    endpoint: 'https://staging.customer.example.org/private-agent',
    version: 'declared-v17'
  },
  probes: [
    { id: 'PROBE_001', controlIds: ['ARL-KB-032', 'ARL-KB-065'],
      body: { prompt: 'canary_BENIGN_INPUT_DO_NOT_DISPLAY' } },
    { id: 'PROBE_002', controlIds: ['ARL-KB-090'],
      body: { prompt: 'benign synthetic second input' } }
  ]
});
const roe = JSON.stringify({
  schema: 'arl.external-agent-roe.v1',
  manifestSha256: hash(manifest),
  targetEndpoint: 'https://staging.customer.example.org/private-agent',
  owner: 'Synthetic staging owner', operator: 'Synthetic reviewer',
  authorisationReference: 'Synthetic fixture is not a customer permission',
  environment: 'isolated-staging', syntheticDataOnly: true,
  notBeforeUtc: '2026-10-23T17:00:00Z',
  notAfterUtc: '2026-10-23T19:00:00Z',
  allowedProbeIds: ['PROBE_001','PROBE_002']
});

async function inputs() {
  const record = await runExternalAssessment({
    manifestRaw: manifest, roeRaw: roe, operator: 'Synthetic reviewer',
    acknowledged: true, now: () => date,
    send: async ({ bodyBytes }) => ({
      status: JSON.parse(bodyBytes).prompt.includes('second') ? 403 : 200,
      body: Buffer.from('{"response":"SECRET_RAW_AGENT_OUTPUT"}')
    })
  });
  return { manifestRaw: manifest, roeRaw: roe,
    observationRaw: JSON.stringify(record) };
}

test('operator export shows exactly 108 controls and preserves HOLD with candidate-only evidence', async () => {
  const dossier = buildExternalOperatorDossier(await inputs());
  assert.equal(dossier.controlsTotal, 108);
  assert.equal(dossier.candidateControlCount, 3);
  assert.equal(dossier.candidateProbeCount, 2);
  assert.equal(dossier.authoritativeSnapshotId, null);
  assert.equal(dossier.evidenceAccepted, false);
  assert.equal(dossier.confirmedFindings, 0);
  assert.equal(dossier.securityVerdict, 'none');
  assert.equal(dossier.deploymentDecision, 'hold');
  assert.equal(dossier.databaseModified, false);
  assert.ok(dossier.controls.every(c =>
    c.applicability === 'unknown' && c.assessmentResult === 'not_assessed' &&
    c.evidenceAccepted === false));
  const html = renderExternalOperatorHtml(dossier);
  assert.match(html, /^<!doctype html>/);
  assert.match(html, /Deployment HOLD/);
  assert.match(html, /108/);
  assert.match(html, /PROBE_001/);
  assert.match(html, /HTTP 200/);
  assert.match(html, /HTTP 403/);
  assert.match(html, /NOT ASSESSED/);
  assert.match(html, /authorisation/i);
  assert.match(html, /sha256-/);
  assert.doesNotMatch(html, /<script\b|<form\b|onerror\s*=/i);
  assert.doesNotMatch(html, /https?:\/\//);
  assert.doesNotMatch(html, /SECRET_RAW_AGENT_OUTPUT|canary_BENIGN_INPUT_DO_NOT_DISPLAY/);
  assert.match(html, /&lt;img src=x onerror=alert\(1\)&gt;/);
});

test('cannot render a forged PASS, accepted evidence, inflated count or control mapping', async () => {
  const good = buildExternalOperatorDossier(await inputs());
  for (const patch of [
    { securityVerdict: 'pass' }, { deploymentDecision: 'proceed' },
    { evidenceAccepted: true }, { confirmedFindings: 1 },
    { controlsTotal: 107 },
    { authoritativeSnapshotId: 'sys_fake' },
    { controls: good.controls.map((c,i) => i ? c : {
      ...c, applicability: 'applicable'
    }) },
    { probes: good.probes.map((p,i) => i ? p : {
      ...p, securityVerdict: 'pass'
    }) }
  ]) assert.throws(() => renderExternalOperatorHtml({ ...good, ...patch }));
});

test('source tampering and changed manifest never export a dashboard', async () => {
  const data = await inputs();
  const corrupted = JSON.parse(data.observationRaw);
  corrupted.observations[0].httpStatus = 418;
  assert.throws(() => buildExternalOperatorDossier({
    ...data, observationRaw: JSON.stringify(corrupted)
  }), /digest mismatch/);
  const changedManifest = JSON.stringify({
    ...JSON.parse(data.manifestRaw),
    target: { ...JSON.parse(data.manifestRaw).target, version: 'v18' }
  });
  assert.throws(() => buildExternalOperatorDossier({
    ...data, manifestRaw: changedManifest
  }));
});

test('private atomic HTML exporter is repeatable and rejects public/symlink destinations', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'arl-external-operator-'));
  const output = path.join(dir, 'private');
  const dossier = buildExternalOperatorDossier(await inputs());
  try {
    const one = writeExternalOperatorHtml({ dossier, outputDirectory: output });
    assert.equal(one.status, 'created');
    assert.equal(one.databaseModified, false);
    const stat = fs.statSync(one.filePath);
    assert.equal(stat.mode & 0o077, 0);
    assert.equal(fs.statSync(output).mode & 0o077, 0);
    assert.equal(hash(fs.readFileSync(one.filePath)), one.sha256);
    const repeat = writeExternalOperatorHtml({ dossier, outputDirectory: output });
    assert.equal(repeat.status, 'unchanged');
    assert.equal(repeat.filePath, one.filePath);
    fs.chmodSync(one.filePath, 0o644);
    assert.throws(() => writeExternalOperatorHtml({ dossier, outputDirectory: output }));
    fs.chmodSync(one.filePath, 0o600);
    const alias = path.join(dir, 'alias');
    fs.symlinkSync(output, alias);
    assert.throws(() => writeExternalOperatorHtml({
      dossier, outputDirectory: alias
    }), /symlinked/);
    fs.chmodSync(output, 0o755);
    assert.throws(() => writeExternalOperatorHtml({
      dossier, outputDirectory: output
    }), /private/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('CLI produces immutable private HTML from three verified input files without network', async () => {
  const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'arl-external-cli-'));
  try {
    const data = await inputs();
    const paths = ['manifestRaw', 'roeRaw', 'observationRaw']
      .map((key,index) => {
        const file = path.join(folder, 'source-' + index + '.json');
        fs.writeFileSync(file, data[key], { mode: 0o600 });
        return file;
      });
    const outdir = path.join(folder, 'private');
    const result = spawnSync(process.execPath, [
      'bin/arl-external-operator.mjs',
      '--manifest', paths[0], '--roe', paths[1],
      '--observation', paths[2], '--out-dir', outdir
    ], {
      cwd: path.resolve(import.meta.dirname, '..'),
      encoding: 'utf8', timeout: 12000
    });
    assert.equal(result.status, 0, result.stderr);
    const report = JSON.parse(result.stdout);
    assert.equal(report.controlsTotal, 108);
    assert.equal(report.evidenceAccepted, false);
    assert.equal(report.status, 'created');
    assert.equal(report.databaseModified, false);
    assert.equal(report.deploymentDecision, 'hold');
    assert.ok(fs.existsSync(report.filePath));
    const again = spawnSync(process.execPath, [
      'bin/arl-external-operator.mjs',
      '--manifest', paths[0], '--roe', paths[1],
      '--observation', paths[2], '--out-dir', outdir
    ], {
      cwd: path.resolve(import.meta.dirname, '..'),
      encoding: 'utf8', timeout: 12000
    });
    assert.equal(again.status, 0, again.stderr);
    assert.equal(JSON.parse(again.stdout).status, 'unchanged');
  } finally {
    fs.rmSync(folder, { recursive: true, force: true });
  }
});
