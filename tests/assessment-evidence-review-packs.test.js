import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildAssessmentEvidenceBatchIndex
} from '../src/agent/assessment-evidence-batch-index.mjs';
import {
  buildAssessmentEvidenceReviewPacks
} from '../src/agent/assessment-evidence-review-packs.mjs';

const queue = {
  complete: true,
  systemSnapshotId: 'snap',
  total: 4,
  lanes: {
    evidence_collection: [],
    test_planning: [7, 8, 9].map(n => ({
      controlId: 'ARL-KB-' + String(n).padStart(3, '0')
    }))
  }
};
const index = buildAssessmentEvidenceBatchIndex(queue);

function criterion(requirementIndex, mode, requirement, extra = {}) {
  const statuses = {
    machine_collectable: 'static_observation_candidate_review_required',
    human_only: 'accountable_human_evidence_required',
    active_test_or_runtime: 'authorised_runtime_evidence_required'
  };
  return {
    requirementIndex, mode, requirement,
    reviewState: statuses[mode],
    expectedCollectors: mode === 'machine_collectable' ? ['target_identity'] : [],
    candidateEvidenceIds: mode === 'machine_collectable' ? ['e' + requirementIndex] : [],
    criterionSatisfied: false,
    ...extra
  };
}

const controls = [
  {
    controlId: 'ARL-KB-007', passInferred: false, executionAuthorised: false,
    requirementCount: 3,
    criteria: [
      criterion(1, 'machine_collectable', 'Exact assessed system version'),
      criterion(2, 'human_only', 'Accountable reviewer identity for 007'),
      criterion(3, 'active_test_or_runtime', 'Bounded positive and negative evidence')
    ],
    sourceRecords: [],
    summary: {staticMissing:0, sourceLineageIssues:0}
  },
  {
    controlId: 'ARL-KB-008', passInferred: false, executionAuthorised: false,
    requirementCount: 2,
    criteria: [
      criterion(1, 'machine_collectable', 'Exact assessed version for 008'),
      criterion(2, 'human_only', 'Accountable reviewer identity for 008')
    ],
    sourceRecords: [{
      evidenceId: 'e-old', lineageStatus: 'invalid_or_truncated_json'
    }],
    summary: {staticMissing:0, sourceLineageIssues:1}
  },
  {
    controlId: 'ARL-KB-009', passInferred: false, executionAuthorised: false,
    requirementCount: 2,
    criteria: [
      criterion(1, 'human_only', 'Organisation-approved legal-basis analysis'),
      criterion(2, 'machine_collectable', 'Source and configuration evidence', {
        reviewState: 'static_observation_missing',
        expectedCollectors: ['source_and_configuration'],
        candidateEvidenceIds: []
      })
    ],
    sourceRecords: [],
    summary: {staticMissing:1, sourceLineageIssues:0}
  }
];

function triage(overrides = {}) {
  return {
    systemSnapshotId: 'snap',
    controls,
    summary: {
      controls:3, staticCandidates:2, staticMissing:1,
      humanRequirements:3, runtimeRequirements:1, sourceLineageIssues:1
    },
    securityStateChanged:false,
    deploymentDecisionWritten:false,
    ...overrides
  };
}

test('groups same static collector and similar human paperwork without sharing verdict', () => {
  const result = buildAssessmentEvidenceReviewPacks(index, [triage()]);
  assert.equal(result.assessmentControls,3);
  assert.equal(result.excludedControls,1);
  assert.equal(result.criterionCount,7);
  assert.equal(result.summary.staticSourcePackets,2);
  const shared = result.staticCollection.find(pack => pack.theme === 'target_identity');
  assert.deepEqual(shared.controlIds,['ARL-KB-007','ARL-KB-008']);
  assert.equal(shared.taskCount,2);
  assert.deepEqual(shared.tasks.map(t => t.requirementIndex),[1,1]);
  const accountable = result.humanDocumentation.find(pack => pack.theme === 'accountable_review_and_approvals');
  assert.deepEqual(accountable.controlIds,['ARL-KB-007','ARL-KB-008']);
  assert.equal(result.runtimeValidation[0].taskCount,1);
  assert.equal(result.lineageExceptions[0].lineageStatus,'invalid_or_truncated_json');
  assert.equal(result.boundaries.sharedPacketDoesNotImplySharedEvidenceValidity,true);
  assert.equal(result.boundaries.runtimeTestingAuthorised,false);
  assert.equal(result.securityStateChanged,false);
  assert.equal(result.deploymentDecisionWritten,false);
});

test('never treats an absent static observation as existing shared evidence', () => {
  const result = buildAssessmentEvidenceReviewPacks(index,[triage()]);
  const req = result.staticCollection.find(pack => pack.theme === 'source_and_configuration').tasks[0];
  assert.equal(req.reviewState,'static_observation_missing');
  assert.deepEqual(req.candidateEvidenceIds,[]);
});

test('fails closed on incomplete batches, stale snapshots and impersonated verdict', () => {
  assert.throws(() => buildAssessmentEvidenceReviewPacks(index, []), /Exact complete/);
  assert.throws(() => buildAssessmentEvidenceReviewPacks(index, [triage({systemSnapshotId:'other'})]),/mismatch/);
  assert.throws(() => buildAssessmentEvidenceReviewPacks(index, [
    triage({controls:[{...controls[0],passInferred:true},...controls.slice(1)]})
  ]),/mismatch/);
});

test('rejects duplicate, missing and auto-satisfied criteria even with valid batch identity', () => {
  const modified = first => triage({controls:[first,...controls.slice(1)]});
  assert.throws(() => buildAssessmentEvidenceReviewPacks(index,[modified({
    ...controls[0],criteria:[controls[0].criteria[0],controls[0].criteria[0],controls[0].criteria[2]]
  })]),/Duplicate criterion/);
  assert.throws(() => buildAssessmentEvidenceReviewPacks(index,[modified({
    ...controls[0],requirementCount:100
  })]),/Complete criterion/);
  assert.throws(() => buildAssessmentEvidenceReviewPacks(index,[modified({
    ...controls[0],criteria:[{...controls[0].criteria[0],criterionSatisfied:true},...controls[0].criteria.slice(1)]
  })]),/Malformed or judgment/);
  assert.throws(() => buildAssessmentEvidenceReviewPacks(index,[modified({
    ...controls[0],criteria:[controls[0].criteria[0],controls[0].criteria[1],
      {...controls[0].criteria[2],candidateEvidenceIds:['not-authorized']}]
  })]),/Runtime criterion cannot inherit/);
});
