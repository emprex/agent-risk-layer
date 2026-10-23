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
  // A previous project-level human applicability or severity decision is
  // deliberately stale when the external release changes.
  await db.prepare(
    'INSERT INTO project_risk_knowledge_states ' +
    '(id,workspace_id,project_id,entry_id,applicability_status,applicability_reason,' +
    'assessed_by,last_assessed_at,updated_at,created_at) VALUES (?,?,?,?,?,?,?,?,?,?)'
  ).run(id('prs_'), workspace.id, project.id, 'ARL-KB-032',
    'applicable', 'Prior synthetic version was in scope',
    userId, nowIso(), nowIso(), nowIso());
  await db.prepare(
    'INSERT INTO project_risk_context ' +
    '(id,workspace_id,project_id,entry_id,project_severity,rationale,' +
    'assessed_by,assessed_at,updated_at,created_at) VALUES (?,?,?,?,?,?,?,?,?,?)'
  ).run(id('prc_'), workspace.id, project.id, 'ARL-KB-032',
    'high', 'Synthetic prior-version contextual severity',
    userId, nowIso(), nowIso(), nowIso());

  const { transitionExternalTarget } =
    await import('../src/agent/external-agent-version-handoff.mjs');
  await assert.rejects(transitionExternalTarget({
    projectId: project.id, userId, manifestRaw: changedManifest, roeRaw: changedRoe,
    operator: 'Synthetic Operator', expectedCurrentSnapshotId: first.snapshotId,
    reason: 'Version changed: this specific synthetic release requires reassessment.',
    acknowledgeMaterialChange: false
  }), /acknowledgement/);

  const transition = await transitionExternalTarget({
    projectId: project.id, userId, manifestRaw: changedManifest, roeRaw: changedRoe,
    operator: 'Synthetic Operator', expectedCurrentSnapshotId: first.snapshotId,
    reason: 'Version changed: this specific synthetic release requires reassessment.',
    acknowledgeMaterialChange: true
  });
  assert.notEqual(transition.newSnapshotId, first.snapshotId);
  assert.equal(transition.controlsRequiringReassessment, 108);
  assert.equal(transition.priorEvidenceReused, false);
  assert.equal(transition.deploymentDecision, 'hold');
  assert.equal(transition.nextCandidateEvidenceState, 'not_collected');

  const oldAfter = await db.prepare(
    'SELECT status FROM system_snapshots WHERE id=?'
  ).get(first.snapshotId);
  assert.equal(oldAfter.status, 'superseded');
  const fresh = await db.prepare(
    'SELECT source,status,assessment_configuration_json FROM system_snapshots WHERE id=?'
  ).get(transition.newSnapshotId);
  assert.equal(fresh.source, 'arl_external_black_box');
  assert.equal(fresh.status, 'current');
  const freshBinding = JSON.parse(fresh.assessment_configuration_json).targetBinding;
  assert.equal(freshBinding.declaredVersion, 'declared-18');
  assert.equal(freshBinding.versionVerified, false);

  const { intelligenceDigest } = await import('../src/control-intelligence.js');
  const freshEvaluations = await db.prepare(
    'SELECT applicability_status,severity_status,contextual_severity,' +
    'evaluator_id,descriptor_json,content_digest FROM control_snapshot_evaluations ' +
    'WHERE system_snapshot_id=?'
  ).all(transition.newSnapshotId);
  assert.equal(freshEvaluations.length, 108);
  assert.ok(freshEvaluations.every(e =>
    e.applicability_status === 'unknown' &&
    e.severity_status === 'not_evaluated' &&
    e.contextual_severity === null &&
    e.evaluator_id === null &&
    intelligenceDigest(JSON.parse(e.descriptor_json)) === e.content_digest
  ), 'All 108 controls must be unknown and integrity-valid after the change.');

  assert.equal(Number((await db.prepare(
    'SELECT COUNT(*) AS count FROM control_evidence_items WHERE system_snapshot_id=?'
  ).get(transition.newSnapshotId)).count), 0);
  assert.equal(Number((await db.prepare(
    'SELECT COUNT(*) AS count FROM control_evidence_items WHERE system_snapshot_id=?'
  ).get(first.snapshotId)).count), 4);
  assert.equal(Number((await db.prepare(
    'SELECT COUNT(*) AS count FROM control_deployment_decisions WHERE project_id=?'
  ).get(project.id)).count), 0);

  await assert.rejects(importExternalCandidateEvidence({
    ...input, observationRaw: await collect()
  }), /existing snapshot differs/, 'Old-release evidence must never attach to the current release.');

  await assert.rejects(transitionExternalTarget({
    projectId: project.id, userId, manifestRaw: changedManifest, roeRaw: changedRoe,
    operator: 'Synthetic Operator', expectedCurrentSnapshotId: first.snapshotId,
    reason: 'Attempted stale snapshot replay must not supersede an existing release.',
    acknowledgeMaterialChange: true
  }), /exact current external snapshot/);

  const currentCollection = await importExternalCandidateEvidence({
    ...input, manifestRaw: changedManifest, roeRaw: changedRoe,
    observationRaw: JSON.stringify(changedRecord)
  });
  assert.equal(currentCollection.snapshotId, transition.newSnapshotId);
  assert.equal(currentCollection.evidenceVerification, 'unverified');
  assert.equal(currentCollection.candidateEvidenceCount, 2);
  const newEvidence = await db.prepare(
    'SELECT verification_state FROM control_evidence_items WHERE system_snapshot_id=?'
  ).all(transition.newSnapshotId);
  assert.equal(newEvidence.length, 2);
  assert.ok(newEvidence.every(x => x.verification_state === 'unverified'));

});
