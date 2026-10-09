import test from 'node:test';
import assert from 'node:assert/strict';

import { buildAssessmentReviewDossiers } from '../src/agent/assessment-review-dossiers.mjs';

const sha = 'a'.repeat(40);
const snapshot = {
  id: 'snap-1',
  assessmentConfiguration: {targetBinding: {revision: sha}}
};
const ids = ['ARL-KB-007', 'ARL-KB-008'];
const row = (id, lane = 'test_planning') => ({
  controlId: id, lane,
  currentStage: lane === 'evidence_collection' ? 'evidence' : 'test',
  chainStatus: 'test_inconclusive',
  deploymentImpact: 'hold'
});
const queue = {
  complete: true,
  systemSnapshotId: 'snap-1',
  total: 4,
  lanes: {
    test_planning: [row(ids[0])],
    evidence_collection: [row(ids[1], 'evidence_collection')],
    follow_up_blocked: [{
      ...row('ARL-KB-006'),
      lane: 'follow_up_blocked', currentStage: 'remediation',
      chainStatus: 'finding_open', deploymentImpact: 'blocker'
    }],
    human_decision: [{
      ...row('ARL-KB-001'),
      lane: 'human_decision', currentStage: 'deployment_decision'
    }]
  }
};
const requirements = [
  'ARL-KB-007 assessed system, exact version, environment and approved scope',
  'Reviewer identity, role, timestamp and evidence digest',
  'Positive and abuse inputs with expected and observed outputs'
];

function detail(id) {
  return {
    systemSnapshot: snapshot,
    control: {id, title:'Test ' + id},
    testDefinition: {
      id: 'ARL-CHK-' + id.slice(-3),
      digest: 'digest-' + id,
      objective: 'Verify exact snapshot control requirements.',
      method: 'Inspect version-bound records and bounded source metadata.',
      requiredEvidence: requirements,
      passCondition: 'An accountable human confirms each required criterion.',
      failCondition: 'At least one mandatory criterion remains unsupported.',
      limitations: 'Source metadata alone does not prove runtime behavior.'
    },
    tests: [{
      id: 'ctx-' + id,
      controlId: id, systemSnapshotId: 'snap-1',
      checkId: 'ARL-CHK-' + id.slice(-3),
      checkDigest: 'digest-' + id,
      result: 'inconclusive', executionMethod: 'source',
      executionKind: 'initial'
    }],
    evidence: [{
      id: 'cei-' + id,
      controlId: id, systemSnapshotId: 'snap-1',
      testExecutionId: 'ctx-' + id,
      sourceType: 'arl_frozen_source_evidence_collection',
      evidenceClass: 'observed',
      retentionStatus: 'active',
      verificationState: 'verified'
    }]
  };
}

test('produces two complete snapshot-bound review dossiers without asserting any PASS', () => {
  const result = buildAssessmentReviewDossiers({
    queue, details: ids.map(detail), controlIds: ids
  });
  assert.equal(result.controlCount, 2);
  assert.equal(result.targetRevision,sha);
  assert.ok(/^[a-f0-9]{64}$/.test(result.preparationDigestSha256));
  assert.equal(result.dossiers[0].summary.currentVerifiedEvidenceRecords,1);
  assert.equal(result.dossiers[0].summary.sourceMetadataCandidates,0);
  assert.equal(result.dossiers[0].summary.missingStaticMetadata,1);
  assert.equal(result.dossiers[0].summary.requiresHumanDocuments,1);
  assert.equal(result.dossiers[0].summary.requiresSeparateRuntimeAuthorisation,1);
  assert.ok(result.dossiers[0].criteria.every(c => c.criterionSatisfied === false));
  assert.ok(result.dossiers[0].evidenceInventory.every(e => e.isCandidateOnly));
  assert.ok(result.dossiers.every(d => d.outcome === 'operator_review_required'));
  assert.equal(result.testsExecuted,0);
  assert.equal(result.evidencePersisted,0);
  assert.equal(result.evidenceAutomaticallyVerified,0);
  assert.equal(result.securityStateChanged,false);
  assert.equal(result.deploymentDecisionWritten,false);
});

test('does not infer criterion coverage even when evidence record is already verified', () => {
  const result = buildAssessmentReviewDossiers({
    queue, details:[detail(ids[0])], controlIds:[ids[0]]
  });
  assert.equal(result.dossiers[0].evidenceInventory[0].verificationState,'verified');
  assert.equal(result.dossiers[0].criteria[0].reviewState,'static_observation_missing');
  assert.equal(result.dossiers[0].criteria[0].criterionSatisfied,false);
  assert.equal(result.dossiers[0].evidenceAutomaticallyAccepted,false);
});

test('refuses blocked finding and final-decision controls', () => {
  for (const id of ['ARL-KB-006','ARL-KB-001']) {
    assert.throws(() => buildAssessmentReviewDossiers({
      queue, details:[detail(id)], controlIds:[id]
    }),/not independently actionable/);
  }
});

test('rejects partial, duplicate, foreign, stale, and change-of-target inputs', () => {
  assert.throws(() => buildAssessmentReviewDossiers({
    queue:{...queue,complete:false}, details:[detail(ids[0])], controlIds:[ids[0]]
  }),/complete snapshot/);
  assert.throws(() => buildAssessmentReviewDossiers({
    queue,details:[detail(ids[0])],controlIds:[ids[0],ids[0]]
  }),/unique bounded/);
  assert.throws(() => buildAssessmentReviewDossiers({
    queue,details:[detail(ids[1])],controlIds:[ids[0]]
  }),/unrequested controls/);
  assert.throws(() => buildAssessmentReviewDossiers({
    queue,details:[{...detail(ids[0]),systemSnapshot:{...snapshot,id:'old'}}],
    controlIds:[ids[0]]
  }),/exact authoritative snapshot/);
  assert.throws(() => buildAssessmentReviewDossiers({
    queue,details:[detail(ids[0]),{
      ...detail(ids[1]),
      systemSnapshot:{...snapshot,assessmentConfiguration:{targetBinding:{revision:'b'.repeat(40)}}}
    }],
    controlIds:ids
  }),/target binding changed/);
});

test('fails closed on incomplete canonical requirements', () => {
  const altered = detail(ids[0]);
  altered.testDefinition = {...altered.testDefinition,passCondition:''};
  assert.throws(() => buildAssessmentReviewDossiers({
    queue,details:[altered],controlIds:[ids[0]]
  }),/complete authoritative control test definition/);
});

test('rejects cross-control evidence attribution without promoting it', () => {
  const mixed = detail(ids[0]);
  mixed.evidence = mixed.evidence.map(record => ({
    ...record,
    controlId: ids[1]
  }));
  assert.throws(() => buildAssessmentReviewDossiers({
    queue,details:[mixed],controlIds:[ids[0]]
  }),/cross-control test or evidence lineage/);
});
