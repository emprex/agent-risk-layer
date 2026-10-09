import test from 'node:test';
import assert from 'node:assert/strict';

import {
  requiredStaticObservations,
  buildStaticCollectionPreview,
  previewStaticCollection
} from '../src/agent/assessment-static-collection-preview.mjs';

const revision = 'b'.repeat(40);
const frozen = {
  target: {repositoryPath: '/does-not-exist', revision, dirty: false},
  binding: {verified: true, revisionBefore: revision, revisionAfter: revision},
  inspection: {subject: {environment: 'local', projectName: 'synthetic'}}
};
const task = (controlId, extra = {}) => ({
  controlId,
  requirementIndex: 1,
  requirement: 'ARL-KB-007 assessed system, exact version, environment and approved scope',
  reviewState: 'static_observation_missing',
  expectedCollectors: ['target_identity'],
  candidateEvidenceIds: [],
  ...extra
});
const review = {
  systemSnapshotId: 'snap',
  staticCollection: [{
    theme: 'target_identity',
    tasks: [task('ARL-KB-007'), task('ARL-KB-008')]
  }],
  boundaries: {
    passFailInferred: false,
    runtimeTestingAuthorised: false
  },
  securityStateChanged: false,
  deploymentDecisionWritten: false
};

test('one-pass preview reuses identical source requirement without inferring control results', async () => {
  const calls = [];
  const report = await previewStaticCollection({
    repositoryPath: '/does-not-exist',
    frozenInspection: frozen,
    review,
    expectedRevision: revision,
    freezeRepository: async () => {
      calls.push('freeze');
      return {repositoryPath:'/does-not-exist',revision,dirty:false};
    }
  });
  assert.equal(calls.length, 2);
  assert.equal(report.counts.requirements, 1);
  assert.equal(report.counts.criteria, 2);
  assert.equal(report.counts.metadataCandidates, 2);
  assert.ok(/^[a-f0-9]{64}$/.test(report.observationDigestSha256));
  assert.deepEqual(report.criteria.map(x=>x.controlId), ['ARL-KB-007','ARL-KB-008']);
  assert.ok(report.criteria.every(x=>x.criterionSatisfied===false && x.evidenceVerified===false));
  assert.equal(report.testsExecuted,0);
  assert.equal(report.evidencePersisted,0);
  assert.equal(report.evidenceAutomaticallyVerified,0);
  assert.equal(report.passFailInferred,false);
  assert.equal(report.securityStateChanged,false);
  assert.equal(report.deploymentDecisionWritten,false);
});

test('static observations do not count as accepted evidence, even when collector returned data',()=>{
  const observation = {
    schema:'arl.deterministic-evidence-collection.v1',
    targetRevision:revision,
    requirementObservations:[{
      requirement:task('ARL-KB-007').requirement,
      collectors:['target_identity'],
      observations:{target_identity:{revision,environment:'local'}}
    }]
  };
  const result = buildStaticCollectionPreview({review,collection:observation,expectedRevision:revision});
  assert.equal(result.counts.metadataCandidates,2);
  assert.equal(result.criteria[0].state,'static_metadata_collected_for_human_review');
  assert.equal(result.evidenceAutomaticallyVerified,0);
});

test('fails closed if target changes before or during the scan', async () => {
  const input = {
    repositoryPath:'/does-not-exist',frozenInspection:frozen,review,
    expectedRevision:revision
  };
  await assert.rejects(()=>previewStaticCollection({...input,
    freezeRepository:async()=>({repositoryPath:'/does-not-exist',revision:'a'.repeat(40),dirty:false})
  }),/before static collection/);
  let n=0;
  await assert.rejects(()=>previewStaticCollection({...input,
    freezeRepository:async()=>{
      n++;
      return {repositoryPath:'/does-not-exist',revision,dirty:n===2};
    }
  }),/during static collection/);
  await assert.rejects(()=>previewStaticCollection({...input,
    expectedRevision:'a'.repeat(40),
    freezeRepository:async()=>({repositoryPath:'/does-not-exist',revision,dirty:false})
  }),/verified clean frozen/);
});

test('rejects forged review authority and conflicting criterion identities',()=>{
  assert.throws(()=>requiredStaticObservations({...review,boundaries:{
    ...review.boundaries,passFailInferred:true
  }}),/Authoritative read-only/);
  assert.throws(()=>requiredStaticObservations({...review,staticCollection:[{
    tasks:[task('ARL-KB-007'),task('ARL-KB-007',{requirement:'different canonical requirement'})]
  }]}),/Conflicting canonical/);
});

test('rejects malformed or duplicated deterministic collection observations',()=>{
  const original=task('ARL-KB-007').requirement;
  const record={requirement:original,collectors:['target_identity'],observations:{target_identity:{revision}}};
  const observation={
    schema:'arl.deterministic-evidence-collection.v1',targetRevision:revision,
    requirementObservations:[record,record]
  };
  assert.throws(()=>buildStaticCollectionPreview({review,collection:observation,expectedRevision:revision}),
    /duplicated or malformed/);
  assert.throws(()=>buildStaticCollectionPreview({review,collection:{...observation,targetRevision:'a'.repeat(40)},
    expectedRevision:revision}),/revision\/schema mismatch/);
});
