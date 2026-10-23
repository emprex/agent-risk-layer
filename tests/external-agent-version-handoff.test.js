import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';
import {
  prepareExternalTargetHandoff
} from '../src/agent/external-agent-version-handoff.mjs';

const sha = x => createHash('sha256').update(x).digest('hex');
const nowMs = Date.parse('2026-10-23T18:00:00.000Z');
const before = {
  schema: 'arl.external-agent-manifest.v1',
  target: {
    name: 'Synthetic external agent', owner: 'Synthetic owner',
    endpoint: 'https://staging.customer.example.org/agent',
    version: 'declared-build-17'
  },
  probes: [{
    id: 'PROBE_001', controlIds: ['ARL-KB-032'],
    body: { message: 'synthetic staging probe' }
  }]
};
const newManifest = {
  ...before, target: { ...before.target, version: 'declared-build-18' }
};
const newRaw = JSON.stringify(newManifest);
const roe = JSON.stringify({
  schema: 'arl.external-agent-roe.v1',
  manifestSha256: sha(newRaw),
  targetEndpoint: before.target.endpoint, owner: 'Synthetic owner',
  operator: 'Synthetic Operator', authorisationReference: 'Synthetic only',
  environment: 'isolated-staging', syntheticDataOnly: true,
  notBeforeUtc: '2026-10-23T17:00:00Z',
  notAfterUtc: '2026-10-23T19:00:00Z',
  allowedProbeIds: ['PROBE_001']
});
const current = {
  id: 'sys_example_previous', status: 'current',
  source: 'arl_external_black_box',
  assessment_configuration_json: JSON.stringify({
    targetBinding: {
      schema: 'arl.target-binding.external.v1',
      source: 'external_https',
      endpoint: before.target.endpoint,
      declaredVersion: before.target.version,
      targetFingerprint: sha(JSON.stringify([
        before.target.name, before.target.endpoint, before.target.version
      ])),
      manifestSha256: sha(JSON.stringify(before)),
      versionVerified: false
    }
  })
};
const reason = 'Material deployment version changed and requires independent reassessment.';
const input = {
  priorSnapshot: current, manifestRaw: newRaw, roeRaw: roe,
  operator: 'Synthetic Operator',
  expectedCurrentSnapshotId: current.id,
  reason, nowMs
};

test('a material release change generates a new, typed, unknown external snapshot', () => {
  const planned = prepareExternalTargetHandoff(input);
  assert.equal(planned.changedVersion, true);
  assert.equal(planned.changedManifest, true);
  assert.equal(planned.previousEvidenceReusable, false);
  assert.equal(planned.deploymentDecision, 'hold');
  assert.equal(planned.snapshotInput.expectedCurrentSnapshotId, current.id);
  const cfg = planned.snapshotInput.assessmentConfiguration;
  assert.equal(cfg.targetBinding.source, 'external_https');
  assert.equal(cfg.targetBinding.declaredVersion, 'declared-build-18');
  assert.equal(cfg.targetBinding.versionVerified, false);
  assert.equal(cfg.initialContext.previousSnapshotId, current.id);
  assert.equal(cfg.initialContext.reassessmentRequired, true);
  assert.equal(cfg.initialContext.priorEvidenceReused, false);
  assert.equal(cfg.initialContext.materialChangeReasonSha256, sha(reason));
  assert.ok(!Object.hasOwn(cfg.targetBinding, 'revision'),
    'Do not invent a Git SHA for closed-source remote targets.');
});

test('changing probe scope with unchanged release still demands a new snapshot', () => {
  const changed = {
    ...before,
    probes: [{ ...before.probes[0], body: { message: 'new synthetic test scope' } }]
  };
  const raw = JSON.stringify(changed);
  const scopedRoe = JSON.stringify({
    ...JSON.parse(roe),
    manifestSha256: sha(raw)
  });
  const planned = prepareExternalTargetHandoff({
    ...input, manifestRaw: raw, roeRaw: scopedRoe
  });
  assert.equal(planned.changedVersion, false);
  assert.equal(planned.changedManifest, true);
  assert.equal(planned.previousEvidenceReusable, false);
});

test('refuses stale current-snapshot identity or a Git snapshot', () => {
  for (const change of [
    { expectedCurrentSnapshotId: 'sys_other' },
    { priorSnapshot: { ...current, status: 'superseded' } },
    { priorSnapshot: { ...current, source: 'git' } },
    { priorSnapshot: { ...current,
      assessment_configuration_json: JSON.stringify({
        targetBinding: { source: 'git', revision: 'a'.repeat(40) }
      }) } }
  ]) {
    assert.throws(() => prepareExternalTargetHandoff({ ...input, ...change }),
      /External target handoff blocked/);
  }
});

test('refuses an unrelated endpoint and missing operator reason', () => {
  const otherManifest = JSON.stringify({
    ...newManifest,
    target: { ...newManifest.target, endpoint: 'https://another.customer.example.org/agent' }
  });
  const otherRoe = JSON.stringify({
    ...JSON.parse(roe),
    manifestSha256: sha(otherManifest),
    targetEndpoint: 'https://another.customer.example.org/agent'
  });
  assert.throws(() => prepareExternalTargetHandoff({
    ...input, manifestRaw: otherManifest, roeRaw: otherRoe
  }), /endpoint changed/);
  assert.throws(() => prepareExternalTargetHandoff({
    ...input, reason: 'change'
  }), /40-800/);
});

test('no change means no automatic reassessment or duplicate handoff', () => {
  const raw = JSON.stringify(before);
  const sameRoe = JSON.stringify({
    ...JSON.parse(roe), manifestSha256: sha(raw)
  });
  assert.throws(() => prepareExternalTargetHandoff({
    ...input, manifestRaw: raw, roeRaw: sameRoe
  }), /no material version or manifest change/);
});

test('ROE mismatch, wrong operator or expired scope cannot authorise handoff', () => {
  assert.throws(() => prepareExternalTargetHandoff({
    ...input, operator: 'Other person'
  }));
  assert.throws(() => prepareExternalTargetHandoff({
    ...input, nowMs: Date.parse('2026-10-24T18:00:00Z')
  }));
  assert.throws(() => prepareExternalTargetHandoff({
    ...input, roeRaw: JSON.stringify({
      ...JSON.parse(roe), allowedProbeIds: []
    })
  }));
});
