import test from 'node:test';
import assert from 'node:assert/strict';
import { buildPilotEvidenceLineageTriage } from '../src/agent/pilot-evidence-lineage-triage.mjs';

const rev = 'a'.repeat(40);
const ref = 'arl_frozen_source_evidence_collection_v2:' + rev + ':ARL-KB-007:' + 'b'.repeat(64);
const machine = 'ARL-KB-007 assessed system, exact version, environment and approved scope';
const human = 'ARL-KB-007 approved provider and configuration record, including data and network boundaries';
const active = 'Positive and abuse inputs with expected and observed outputs';
const collection = {
  schema: 'arl.deterministic-evidence-collection.v1',
  targetRevision: rev,
  requirementObservations: [{
    requirement: machine,
    collectors: ['target_identity'],
    observations: {target_identity: {revision: rev, environment: 'local'}}
  }]
};
const testResult = {
  id: 'test-1',
  systemSnapshotId: 'snap',
  controlId: 'ARL-KB-007',
  checkId: 'check-7',
  checkDigest: 'check-digest',
  result: 'inconclusive',
  executionMethod: 'arl_frozen_source_evidence_collection_v2',
  executionKind: 'initial',
  inputReference: ref,
  observedResult: 'Observed frozen-target facts:\n{}\nRequirement-specific deterministic observations:\n' +
    JSON.stringify(collection) +
    '\nThis collection does not assert that any canonical requirement is satisfied and does not infer PASS/FAIL.'
};
const evidence = {
  id: 'ev-1',
  systemSnapshotId: 'snap',
  controlId: 'ARL-KB-007',
  testExecutionId: 'test-1',
  sourceType: 'arl_frozen_source_evidence_collection_v2',
  sourceReference: ref,
  retentionStatus: 'active',
  verificationState: 'unverified'
};
const detail = {
  systemSnapshot: {id: 'snap', versionIdentifier: rev},
  control: {id: 'ARL-KB-007'},
  testDefinition: {
    id: 'check-7',
    digest: 'check-digest',
    requiredEvidence: [machine, human, active]
  },
  tests: [testResult],
  testHistory: [testResult],
  evidence: [evidence],
  evidenceHistory: [evidence]
};
const plan = {
  systemSnapshotId: 'snap',
  controlCount: 1,
  controls: [{controlId:'ARL-KB-007',chainStatus:'test_inconclusive'}]
};
const triage = d => buildPilotEvidenceLineageTriage(plan, [d]);

test('links structured source observations to machine criterion as review candidates only', () => {
  const result = triage(detail);
  assert.equal(result.summary.staticCandidates, 1);
  assert.equal(result.summary.humanRequirements, 1);
  assert.equal(result.summary.runtimeRequirements, 1);
  assert.equal(result.controls[0].criteria[0].reviewState,'static_observation_candidate_review_required');
  assert.deepEqual(result.controls[0].criteria[0].candidateEvidenceIds,['ev-1']);
  assert.equal(result.controls[0].criteria[0].criterionSatisfied,false);
  assert.equal(result.controls[0].criteria[1].reviewState,'accountable_human_evidence_required');
  assert.equal(result.controls[0].criteria[2].reviewState,'authorised_runtime_evidence_required');
  assert.equal(result.controls[0].sourceRecords.length,1);
  assert.equal(result.controls[0].passInferred,false);
  assert.equal(result.controls[0].executionAuthorised,false);
  assert.equal(result.securityStateChanged,false);
  assert.equal(result.deploymentDecisionWritten,false);
});

test('rejects a source reference mismatch without accepting a machine candidate',()=>{
  const result = triage({...detail,evidence:[{...evidence,sourceReference:'other'}],evidenceHistory:[]});
  assert.equal(result.summary.staticMissing,1);
  assert.equal(result.summary.sourceLineageIssues,1);
  assert.equal(result.controls[0].sourceRecords[0].lineageStatus,'source_test_or_check_lineage_mismatch');
});

test('rejects stale snapshot, check digest or wrong target revision', () => {
  assert.throws(()=>triage({...detail,systemSnapshot:{id:'other'}}), /different snapshots/);
  const mismatch = triage({...detail,tests:[{...testResult,checkDigest:'old'}],testHistory:[]});
  assert.equal(mismatch.summary.staticCandidates,0);
  assert.equal(mismatch.summary.sourceLineageIssues,1);
  const wrongRev = triage({...detail,systemSnapshot:{id:'snap',versionIdentifier:'c'.repeat(40)}});
  assert.equal(wrongRev.controls[0].sourceRecords[0].lineageStatus,'target_revision_mismatch');
});

test('fails closed for truncated JSON and historical source observation',()=>{
  const truncated=triage({...detail,tests:[{...testResult,observedResult:
    'Requirement-specific deterministic observations:\n' + JSON.stringify(collection).slice(0,10)}],testHistory:[]});
  assert.equal(truncated.summary.staticCandidates,0);
  assert.equal(truncated.summary.sourceLineageIssues,1);
  const historical=triage({...detail,evidence:[{...evidence,systemSnapshotId:'old'}],evidenceHistory:[]});
  assert.equal(historical.summary.staticCandidates,0);
  assert.equal(historical.controls[0].sourceRecords.length,0);
});

test('rejects an incomplete plan instead of claiming that a missing control was analysed',()=>{
  assert.throws(()=>buildPilotEvidenceLineageTriage({...plan,controlCount:12},[detail]),/Complete snapshot-bound/);
});

test('KB-009 human approval criterion never receives a static observation candidate', () => {
  const controlId = 'ARL-KB-009';
  const approval = 'ARL-KB-009 tests and approval attributable to the exact version or immutable artefact';
  const identity = 'ARL-KB-009 exact assessed production version, environment and authoritative deployment identity';
  const sourceRef = 'arl_frozen_source_evidence_collection_v2:' + rev + ':' + controlId + ':' + 'b'.repeat(64);
  const observations = {
    schema: 'arl.deterministic-evidence-collection.v1',
    targetRevision: rev,
    requirementObservations: [
      {requirement: approval, collectors:['dependency_and_build'], observations:{dependency_and_build:{lockfiles:['lockfile']}}},
      {requirement: identity, collectors:['target_identity'], observations:{target_identity:{revision:rev}}}
    ]
  };
  const originalTest = {
    ...testResult,
    controlId,
    checkId:'check-9',
    inputReference:sourceRef,
    observedResult:'Requirement-specific deterministic observations:\\n' + JSON.stringify(observations) +
      '\\nThis collection does not assert that any canonical requirement is satisfied'
  };
  const originalEvidence = {...evidence, controlId, sourceReference:sourceRef};
  const targetDetail = {
    ...detail,
    control:{id:controlId},
    testDefinition:{id:'check-9',digest:'check-digest',requiredEvidence:[identity,approval]},
    tests:[originalTest],
    testHistory:[],
    evidence:[originalEvidence],
    evidenceHistory:[]
  };
  const targetPlan = {...plan,controls:[{controlId,chainStatus:'test_inconclusive'}]};
  const result = buildPilotEvidenceLineageTriage(targetPlan,[targetDetail]);
  assert.equal(result.summary.staticCandidates,1);
  assert.equal(result.summary.humanRequirements,1);
  assert.equal(result.controls[0].criteria[0].criterionSatisfied,false);
  assert.equal(result.controls[0].criteria[1].reviewState,'accountable_human_evidence_required');
  assert.deepEqual(result.controls[0].criteria[1].candidateEvidenceIds,[]);
  assert.equal(result.controls[0].passInferred,false);
  assert.equal(result.securityStateChanged,false);
});
