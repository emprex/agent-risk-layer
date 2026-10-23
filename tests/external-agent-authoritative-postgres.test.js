import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';

const ciUrl = process.env.ARL_CI_POSTGRES_URL || '';
const run = process.env.CI === 'true' && Boolean(ciUrl) &&
  process.env.DATABASE_URL === ciUrl;

const sha = text => createHash('sha256').update(text).digest('hex');

test('dedicated ephemeral PostgreSQL: bind candidates to external snapshot, reject replay and version change', {
  skip: !run && 'Requires the exact disposable GitHub Actions PostgreSQL service.',
  timeout: 90000
}, async () => {
  const url = new URL(ciUrl);
  assert.equal(url.hostname, '127.0.0.1');
  assert.equal(url.pathname, '/arl_ci');
  assert.equal(url.username, 'arl_ci');

  const { db, id, nowIso, initialiseDatabase } = await import('../src/db.js');
  const { createWorkspace } = await import('../src/workspaces.js');
  const { createSecurityProject } = await import('../src/control-plane-core.js');
  const { runExternalAssessment } = await import('../src/agent/external-agent-assessment.mjs');
  const { importExternalCandidateEvidence } = await import('../src/agent/external-agent-authoritative-import.mjs');
  await initialiseDatabase();

  const userId = id('usr_');
  await db.prepare(
    'INSERT INTO users (id,email,password_hash,created_at) VALUES (?,?,?,?)'
  ).run(userId, id('tester_') + '@synthetic.invalid', 'synthetic-no-login', nowIso());
  const workspace = await createWorkspace(userId, 'Synthetic external assessment workspace');
  const project = await createSecurityProject({
    userId, workspaceId: workspace.id,
    name: 'Synthetic staging agent', environment: 'staging'
  });

  const manifest = JSON.stringify({
    schema: 'arl.external-agent-manifest.v1',
    target: {
      name: 'Synthetic agent', owner: 'Synthetic owner',
      endpoint: 'https://staging.customer.example.org/v1/agent',
      version: 'declared-17'
    },
    probes: [{ id: 'PROBE_001', controlIds: ['ARL-KB-032', 'ARL-KB-065'],
      body: { message: 'controlled synthetic probe' } }]
  });
  const now = Date.now();
  const roe = JSON.stringify({
    schema: 'arl.external-agent-roe.v1',
    manifestSha256: sha(manifest),
    targetEndpoint: 'https://staging.customer.example.org/v1/agent',
    owner: 'Synthetic owner', operator: 'Synthetic Operator',
    authorisationReference: 'Synthetic-only CI ROE, not a customer permit',
    environment: 'isolated-staging', syntheticDataOnly: true,
    notBeforeUtc: new Date(now - 10000).toISOString().replace(/\.\d{3}Z$/, 'Z'),
    notAfterUtc: new Date(now + 10000).toISOString().replace(/\.\d{3}Z$/, 'Z'),
    allowedProbeIds: ['PROBE_001']
  });
  const collect = async () => JSON.stringify(await runExternalAssessment({
    manifestRaw: manifest, roeRaw: roe, operator: 'Synthetic Operator',
    acknowledged: true, now: () => now,
    send: async () => ({ status: 200, body: Buffer.from('{}') })
  }));

  const firstRaw = await collect();
  const input = {
    projectId: project.id, userId, manifestRaw: manifest,
    roeRaw: roe, observationRaw: firstRaw,
    acknowledgeCandidateImport: true
  };
  const first = await importExternalCandidateEvidence(input);
  assert.equal(first.candidateOnly, true);
  assert.equal(first.candidateEvidenceCount, 2);
  assert.equal(first.securityVerdict, 'none');
  assert.equal(first.deploymentDecision, 'hold');

  const snapshot = await db.prepare(
    'SELECT source,status,assessment_configuration_json FROM system_snapshots WHERE id=?'
  ).get(first.snapshotId);
  assert.equal(snapshot.source, 'arl_external_black_box');
  assert.equal(snapshot.status, 'current');
  const binding = JSON.parse(snapshot.assessment_configuration_json).targetBinding;
  assert.equal(binding.declaredVersion, 'declared-17');
  assert.equal(binding.versionVerified, false);
  assert.equal(binding.manifestSha256, sha(manifest));

  const records = await db.prepare(
    'SELECT verification_state,evidence_class,system_snapshot_id FROM control_evidence_items WHERE project_id=?'
  ).all(project.id);
  assert.equal(records.length, 2);
  assert.ok(records.every(x => x.verification_state === 'unverified' &&
    x.evidence_class === 'imported' && x.system_snapshot_id === first.snapshotId));
  const controls = await db.prepare(
    'SELECT COUNT(*) AS count FROM control_snapshot_evaluations WHERE system_snapshot_id=?'
  ).get(first.snapshotId);
  assert.equal(Number(controls.count), 108);
  assert.equal(Number((await db.prepare(
    'SELECT COUNT(*) AS count FROM control_deployment_decisions WHERE project_id=?'
  ).get(project.id)).count), 0);

  await assert.rejects(importExternalCandidateEvidence(input), /duplicate collection/);
  assert.equal(Number((await db.prepare(
    'SELECT COUNT(*) AS count FROM external_agent_candidate_imports WHERE project_id=?'
  ).get(project.id)).count), 1);

  const another = await importExternalCandidateEvidence({
    ...input, observationRaw: await collect()
  });
  assert.equal(another.snapshotId, first.snapshotId);
  assert.equal(another.candidateEvidenceCount, 2);

  const changedManifest = JSON.stringify({
    ...JSON.parse(manifest), target: { ...JSON.parse(manifest).target, version: 'declared-18' }
  });
  const changedRoe = JSON.stringify({
    ...JSON.parse(roe), manifestSha256: sha(changedManifest)
  });
  const changedRecord = await runExternalAssessment({
    manifestRaw: changedManifest, roeRaw: changedRoe,
    operator: 'Synthetic Operator', acknowledged: true, now: () => now,
    send: async () => ({ status: 200, body: Buffer.from('{}') })
  });
  await assert.rejects(importExternalCandidateEvidence({
    ...input, manifestRaw: changedManifest, roeRaw: changedRoe,
    observationRaw: JSON.stringify(changedRecord)
  }), /existing snapshot differs/);

  const unboundUser = id('usr_');
  await assert.rejects(importExternalCandidateEvidence({
    ...input, userId: unboundUser, observationRaw: await collect()
  }), /project authorisation failed/);
  assert.equal(Number((await db.prepare(
    'SELECT COUNT(*) AS count FROM external_agent_candidate_imports WHERE project_id=?'
  ).get(project.id)).count), 2);
});
