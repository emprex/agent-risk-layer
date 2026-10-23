import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';
import { runExternalAssessment } from '../src/agent/external-agent-assessment.mjs';
import {
  prepareExternalCandidateImport,
  externalCandidateSnapshotInput
} from '../src/agent/external-agent-authoritative-import.mjs';

const sha = text => createHash('sha256').update(text).digest('hex');
const now = Date.now();
const manifest = JSON.stringify({
  schema: 'arl.external-agent-manifest.v1',
  target: {
    name: 'Synthetic closed-source agent', owner: 'Synthetic owner',
    endpoint: 'https://staging.customer.example.org/v1/agent',
    version: 'customer-declared-v17'
  },
  probes: [{ id: 'PROBE_001', controlIds: ['ARL-KB-032', 'ARL-KB-065'],
    body: { message: 'benign synthetic request' } }]
});
const roe = JSON.stringify({
  schema: 'arl.external-agent-roe.v1',
  manifestSha256: sha(manifest),
  targetEndpoint: 'https://staging.customer.example.org/v1/agent',
  operator: 'Local synthetic operator', owner: 'Synthetic owner',
  authorisationReference: 'Synthetic test only - not a real customer authorisation',
  environment: 'isolated-staging', syntheticDataOnly: true,
  notBeforeUtc: new Date(now - 60_000).toISOString().replace(/\.\d{3}Z$/, 'Z'),
  notAfterUtc: new Date(now + 60_000).toISOString().replace(/\.\d{3}Z$/, 'Z'),
  allowedProbeIds: ['PROBE_001']
});

async function fixture() {
  const record = await runExternalAssessment({
    manifestRaw: manifest, roeRaw: roe,
    operator: 'Local synthetic operator', acknowledged: true,
    now: () => now,
    send: async () => ({
      status: 200, body: Buffer.from('{"status":"synthetic"}')
    })
  });
  return JSON.stringify(record);
}

test('external snapshot uses declared version, exact typed identity, and no fake Git SHA', async () => {
  const result = prepareExternalCandidateImport({
    manifestRaw: manifest, roeRaw: roe, observationRaw: await fixture()
  });
  assert.match(result.targetFingerprint, /^[a-f0-9]{64}$/);
  assert.equal(result.controls.length, 2);
  const snapshot = externalCandidateSnapshotInput(result);
  assert.equal(snapshot.source, 'arl_external_black_box');
  assert.equal(snapshot.assessmentConfiguration.targetBinding.source, 'external_https');
  assert.equal(snapshot.assessmentConfiguration.targetBinding.declaredVersion, 'customer-declared-v17');
  assert.equal(snapshot.assessmentConfiguration.targetBinding.versionVerified, false);
  assert.equal(snapshot.assessmentConfiguration.initialContext.controlDecisionInferred, false);
  assert.equal(result.securityVerdict, 'none');
  assert.equal(result.deploymentDecision, 'hold');
  assert.ok(!('revision' in snapshot.assessmentConfiguration.targetBinding));
});

test('collection identity does not contaminate target identity for the same declared version', async () => {
  const first = prepareExternalCandidateImport({
    manifestRaw: manifest, roeRaw: roe, observationRaw: await fixture()
  });
  const second = prepareExternalCandidateImport({
    manifestRaw: manifest, roeRaw: roe, observationRaw: await fixture()
  });
  assert.notEqual(first.collectionId, second.collectionId);
  assert.equal(first.targetFingerprint, second.targetFingerprint);
});

test('source evidence metadata must pass exact ROE and receipt consistency', async () => {
  const observationRaw = await fixture();
  const different = JSON.stringify({
    ...JSON.parse(manifest),
    target: { ...JSON.parse(manifest).target, version: 'new-release' }
  });
  assert.throws(() => prepareExternalCandidateImport({
    manifestRaw: different, roeRaw: roe, observationRaw
  }));
  const counterfeit = JSON.parse(observationRaw);
  counterfeit.securityVerdict = 'pass';
  assert.throws(() => prepareExternalCandidateImport({
    manifestRaw: manifest, roeRaw: roe, observationRaw: JSON.stringify(counterfeit)
  }));
});

test('cannot construct a snapshot with a forged verified-version candidate', () => {
  assert.throws(() => externalCandidateSnapshotInput({
    candidateOnly: true, versionVerified: true, permissionsIndependentlyVerified: false,
    securityVerdict: 'none', targetFingerprint: 'f'.repeat(64),
    manifestSha256: 'a'.repeat(64)
  }));
});
