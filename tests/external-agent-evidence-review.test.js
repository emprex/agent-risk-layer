import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { test } from 'node:test';
import { runExternalAssessment } from '../src/agent/external-agent-assessment.mjs';
import {
  verifyExternalObservation, buildExternalControlReviewQueue
} from '../src/agent/external-agent-evidence-review.mjs';

const digest = s => createHash('sha256').update(s).digest('hex');
const clock = Date.parse('2026-10-23T18:00:00.000Z');
const manifest = JSON.stringify({
  schema: 'arl.external-agent-manifest.v1',
  target: {
    name: 'Authorised synthetic agent',
    owner: 'Staging owner',
    endpoint: 'https://agent.customer.example.org/agent',
    version: 'release-17'
  },
  probes: [
    { id: 'PROBE_001', controlIds: ['ARL-KB-032', 'ARL-KB-065'], body: { prompt: 'benign synthetic check' } },
    { id: 'PROBE_002', controlIds: ['ARL-KB-090'], body: { prompt: 'second synthetic check' } }
  ]
});
const roe = JSON.stringify({
  schema: 'arl.external-agent-roe.v1',
  manifestSha256: digest(manifest),
  targetEndpoint: 'https://agent.customer.example.org/agent',
  operator: 'Operator',
  owner: 'Staging owner',
  authorisationReference: 'Signed ROE held separately by test owner',
  environment: 'isolated-staging',
  syntheticDataOnly: true,
  notBeforeUtc: '2026-10-23T17:59:00Z',
  notAfterUtc: '2026-10-23T18:01:00Z',
  allowedProbeIds: ['PROBE_001', 'PROBE_002']
});

async function collected(send = async () => ({ status: 200, body: Buffer.from('{"result":"candidate"}') })) {
  const result = await runExternalAssessment({
    manifestRaw: manifest, roeRaw: roe, operator: 'Operator',
    acknowledged: true, now: () => clock, send
  });
  return JSON.stringify(result);
}

function recalc(data) {
  const { artifactSha256: _unused, ...payload } = data;
  return JSON.stringify({ ...payload, artifactSha256: digest(JSON.stringify(payload)) });
}

test('offline verifier checks exact manifest/ROE and preserves no security verdict', async () => {
  const observationRaw = await collected();
  const reviewed = verifyExternalObservation({
    manifestRaw: manifest, roeRaw: roe, observationRaw
  });
  assert.equal(reviewed.consistency, 'consistent_only');
  assert.equal(reviewed.exactManifestAndRoeBinding, true);
  assert.equal(reviewed.observationsConsistent, 2);
  assert.equal(reviewed.evidenceAccepted, false);
  assert.equal(reviewed.securityVerdict, 'none');
  assert.equal(reviewed.responsesIndependentlyAttested, false);
  assert.equal(reviewed.sourceAuthenticityVerified, false);
});

test('108-control review queue distinguishes mapped candidate evidence from validated controls', async () => {
  const queue = buildExternalControlReviewQueue({
    manifestRaw: manifest, roeRaw: roe, observationRaw: await collected()
  });
  assert.equal(queue.controlsTotal, 108);
  assert.equal(queue.controls.length, 108);
  assert.equal(queue.mappedControlCount, 3);
  assert.equal(queue.controls.find(x => x.controlId === 'ARL-KB-032').candidateProbeIds[0], 'PROBE_001');
  assert.equal(queue.controls.find(x => x.controlId === 'ARL-KB-090').candidateProbeIds[0], 'PROBE_002');
  assert.equal(queue.controls.find(x => x.controlId === 'ARL-KB-091').candidateOnly, false);
  assert.ok(queue.controls.every(x => x.assessmentResult === 'not_assessed' &&
    x.applicability === 'unknown' && x.evidenceAccepted === false));
  assert.equal(queue.authoritativeSnapshotId, null);
  assert.equal(queue.databaseModified, false);
  assert.equal(queue.deploymentDecision, 'hold');
});

test('fails if untrusted observation bytes are modified without updating content digest', async () => {
  const good = JSON.parse(await collected());
  good.observations[0].httpStatus = 500;
  assert.throws(() => verifyExternalObservation({
    manifestRaw: manifest, roeRaw: roe, observationRaw: JSON.stringify(good)
  }), /digest mismatch/);
});

test('recomputing a digest cannot forge authority, finding or confirmed version', async () => {
  const original = JSON.parse(await collected());
  for (const changes of [
    { securityVerdict: 'pass' }, { findingsConfirmed: 1 },
    { evidenceStatus: 'accepted' },
    { target: { ...original.target, versionVerified: true } },
    { authorisationVerifiedIndependently: true }
  ]) {
    assert.throws(() => verifyExternalObservation({
      manifestRaw: manifest, roeRaw: roe,
      observationRaw: recalc({ ...original, ...changes })
    }));
  }
});

test('recomputing digest cannot swap probe IDs, control IDs, request bytes or timing', async () => {
  const orig = JSON.parse(await collected());
  for (const changes of [
    { probeId: 'PROBE_002' }, { controlIds: ['ARL-KB-032'] },
    { requestBytes: 2 }, { requestSha256: '0'.repeat(64) },
    { observedAtUtc: '2026-10-23T20:00:00.000Z' }
  ]) {
    const corrupted = structuredClone(orig);
    Object.assign(corrupted.observations[0], changes);
    assert.throws(() => verifyExternalObservation({
      manifestRaw: manifest, roeRaw: roe, observationRaw: recalc(corrupted)
    }));
  }
});

test('unlisted fields, bogus HTTP codes and oversized response claims are rejected', async () => {
  const orig = JSON.parse(await collected());
  for (const changes of [
    { extraUntrustedField: 'spoofed' }, { httpStatus: 900 },
    { responseBytes: 65537 }, { redirectNotFollowed: true }
  ]) {
    const corrupted = structuredClone(orig);
    Object.assign(corrupted.observations[0], changes);
    assert.throws(() => verifyExternalObservation({
      manifestRaw: manifest, roeRaw: roe, observationRaw: recalc(corrupted)
    }));
  }
});

test('bound observation rejects different manifest or unsigned owner claims', async () => {
  const original = await collected();
  const altered = JSON.stringify({
    ...JSON.parse(manifest),
    target: { ...JSON.parse(manifest).target, version: 'release-18' }
  });
  assert.throws(() => verifyExternalObservation({
    manifestRaw: altered, roeRaw: roe, observationRaw: original
  }));
  const dishonestRoe = JSON.stringify({
    ...JSON.parse(roe), owner: 'Different owner'
  });
  assert.throws(() => verifyExternalObservation({
    manifestRaw: manifest, roeRaw: dishonestRoe, observationRaw: original
  }));
});

test('network errors preserve the absence of HTTP-response evidence', async () => {
  const raw = await collected(async () => { throw new Error('network unavailable'); });
  const result = verifyExternalObservation({
    manifestRaw: manifest, roeRaw: roe, observationRaw: raw
  });
  assert.equal(result.observationsConsistent, 2);
  const changed = JSON.parse(raw);
  changed.observations[0].httpStatus = 200;
  assert.throws(() => verifyExternalObservation({
    manifestRaw: manifest, roeRaw: roe, observationRaw: recalc(changed)
  }));
});
