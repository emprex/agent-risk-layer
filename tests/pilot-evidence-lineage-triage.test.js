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
  assert.deepEqual(result.controls[0].sourceRecords[0].lineageMismatchReasons,['source_reference_mismatch']);
});

test('rejects stale snapshot, check digest or wrong target revision', () => {
  assert.throws(()=>triage({...detail,systemSnapshot:{id:'other'}}), /different snapshots/);
  const mismatch = triage({...detail,tests:[{...testResult,checkDigest:'old'}],testHistory:[]});
  assert.equal(mismatch.summary.staticCandidates,0);
  assert.equal(mismatch.summary.sourceLineageIssues,1);
  assert.deepEqual(mismatch.controls[0].sourceRecords[0].lineageMismatchReasons,['check_digest_mismatch']);
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

test('preserves recovered malformed v2 history without reporting it as an active lineage issue', () => {
  const oldRef = 'arl_frozen_source_evidence_collection_v2:' + rev + ':ARL-KB-007:' + 'c'.repeat(64);
  const oldTest = {
    ...testResult,
    id: 'test-old',
    inputReference: oldRef,
    observedResult: 'Requirement-specific deterministic observations:\n{"truncated":'
  };
  const oldEvidence = {
    ...evidence,
    id: 'ev-old',
    testExecutionId: 'test-old',
    sourceReference: oldRef
  };
  const result = triage({
    ...detail,
    tests: [testResult, oldTest],
    testHistory: [],
    evidence: [evidence, oldEvidence],
    evidenceHistory: []
  });
  assert.equal(result.summary.staticCandidates, 1);
  assert.equal(result.summary.sourceLineageIssues, 0);
  assert.equal(result.summary.historicalSourceLineageIssues, 1);
  assert.equal(result.controls[0].sourceRecords.length, 2);
  const historical = result.controls[0].sourceRecords.find(row => row.evidenceId === 'ev-old');
  assert.equal(historical.lineageStatus, 'structured_observation_truncated');
  assert.equal(historical.lineageIssueState, 'historical_preserved_after_valid_recollection');
  assert.equal(result.controls[0].passInferred, false);
});

test('current recollection supersedes only a historical check digest and never the current test',()=>{
  const oldRef='arl_frozen_source_evidence_collection_v2:'+rev+':ARL-KB-007:'+'c'.repeat(64);
  const prior={...testResult,id:'old-digest-test',checkDigest:'old-digest',inputReference:oldRef};
  const priorEvidence={...evidence,id:'old-digest-evidence',testExecutionId:prior.id,sourceReference:oldRef};
  const result=triage({...detail,tests:[prior,testResult],testHistory:[],
    evidence:[priorEvidence,evidence],evidenceHistory:[]});
  assert.equal(result.summary.sourceLineageIssues,0);
  assert.equal(result.summary.historicalSourceLineageIssues,1);
  assert.equal(result.summary.staticCandidates,1);
  assert.equal(result.controls[0].sourceRecords.find(x=>x.evidenceId===priorEvidence.id)
    .lineageIssueState,'historical_preserved_after_valid_recollection');
  const noRefresh=triage({...detail,tests:[prior],testHistory:[],
    evidence:[priorEvidence],evidenceHistory:[]});
  assert.equal(noRefresh.summary.sourceLineageIssues,1);
  assert.equal(noRefresh.summary.historicalSourceLineageIssues,0);
});

test('a valid recollection never masks an independent broken source link', () => {
  const broken = {
    ...evidence,
    id: 'ev-broken',
    testExecutionId: 'missing-test',
    sourceReference: 'missing'
  };
  const result = triage({
    ...detail,
    evidence: [evidence, broken],
    evidenceHistory: []
  });
  assert.equal(result.summary.staticCandidates, 1);
  assert.equal(result.summary.sourceLineageIssues, 1);
  assert.equal(result.summary.historicalSourceLineageIssues, 0);
  const issue = result.controls[0].sourceRecords.find(row => row.evidenceId === 'ev-broken');
  assert.equal(issue.lineageStatus, 'linked_test_missing');
  assert.equal(issue.lineageIssueState, 'active');
  assert.equal(result.controls[0].passInferred, false);
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
    observedResult:'Requirement-specific deterministic observations:\n' + JSON.stringify(observations) +
      '\nThis collection does not assert that any canonical requirement is satisfied'
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

test('KB-007 partial provider inventory is surfaced without changing criterion authority',()=>{
  const partial = {
    ...collection,
    projection:{incomplete:true, inventoryArraysTruncated:true, fullCollectionSha256:'e'.repeat(64)},
    requirementObservations:[{
      requirement:machine,collectors:['target_identity'],
      observations:{target_identity:{revision:rev,inventory:{items:[],originalCount:12,omittedCount:12,incomplete:true}}}
    }]
  };
  const current={...testResult,observedResult:
    'Requirement-specific deterministic observations:\n'+JSON.stringify(partial)+
    '\nThis collection does not assert that any canonical requirement is satisfied'};
  const result=triage({...detail,tests:[current],testHistory:[]});
  assert.equal(result.summary.staticCandidates,1);
  assert.equal(result.summary.partialInventoryCandidates,1);
  assert.equal(result.controls[0].criteria[0].incompleteInventoryCandidate,true);
  assert.equal(result.controls[0].criteria[0].criterionSatisfied,false);
  assert.equal(result.controls[0].passInferred,false);
  assert.equal(result.deploymentDecisionWritten,false);
});

test('verified human inconclusive review is not mistaken for a frozen collector exception', () => {
  const reference = 'human-review:ARL-KB-007';
  const humanTest = {
    ...testResult, id:'human-test', executionMethod:'consolidated_human_review',
    inputReference: reference
  };
  const humanEvidence = {
    ...evidence, id:'human-evidence', testExecutionId:'human-test',
    sourceType:'consolidated_human_review', evidenceClass:'human_provided',
    sourceReference:reference, verificationState:'verified'
  };
  const result = triage({
    ...detail, tests:[testResult,humanTest], testHistory:[],
    evidence:[evidence,humanEvidence], evidenceHistory:[]
  });
  assert.equal(result.summary.sourceLineageIssues, 0);
  assert.equal(result.controls[0].sourceRecords.find(s => s.evidenceId === humanEvidence.id)
    .lineageStatus,'linked_human_review_not_static_collector');
  assert.equal(result.controls[0].criteria[0].criterionSatisfied,false);
  assert.equal(result.controls[0].passInferred,false);

  const broken = triage({
    ...detail, tests:[testResult,humanTest], testHistory:[],
    evidence:[evidence,{...humanEvidence,sourceReference:'wrong'}], evidenceHistory:[]
  });
  assert.equal(broken.summary.sourceLineageIssues,1);
  assert.equal(broken.controls[0].sourceRecords.find(s => s.evidenceId === humanEvidence.id)
    .lineageStatus,'human_review_lineage_mismatch');
});
