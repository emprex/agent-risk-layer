import test from 'node:test';
import assert from 'node:assert/strict';
import {
  requireInconclusiveReviewEvidence,
  isInconclusiveReviewAlreadyDocumented
} from '../src/agent/inconclusive-review-eligibility.mjs';

const controlId = 'ARL-KB-007';
const snapshotId = 'sys_1';
const revision = 'a'.repeat(40);
const frozenInspection = {
  binding:{verified:true,revisionBefore:revision,revisionAfter:revision},
  target:{dirty:false,revision}
};
const reviewedTest = {
  id:'t1', systemSnapshotId:snapshotId, controlId,
  result:'inconclusive', executionMethod:'consolidated_human_review',
  inputReference:'review:1'
};
const reviewedEvidence = {
  id:'e1', systemSnapshotId:snapshotId, controlId,
  retentionStatus:'active', verificationState:'verified',
  sourceType:'consolidated_human_review', evidenceClass:'human_provided',
  testExecutionId:'t1', sourceReference:'review:1'
};
const detail = {
  control:{id:controlId}, chain:{currentStage:'test',status:'test_inconclusive'},
  systemSnapshot:{id:snapshotId,assessmentConfiguration:{
    targetBinding:{revision}
  }},
  tests:[reviewedTest], evidence:[reviewedEvidence]
};
const call = overrides => requireInconclusiveReviewEvidence({
  detail, snapshotId, revision, frozenInspection, controlId, ...overrides
});

test('accepts only version-bound verified inconclusive human evidence, not a PASS',()=>{
  assert.equal(call().id,'e1');
  assert.throws(()=>call({detail:{...detail,tests:[{...reviewedTest,result:'passed'}]}}),
    /linked.*inconclusive/i);
  assert.throws(()=>call({detail:{...detail,chain:{currentStage:'test',status:'passed'}}}),
    /inconclusive test-stage/);
});

test('rejects changed target SHA, dirty frozen target and changed snapshot',()=>{
  assert.throws(()=>call({revision:'b'.repeat(40)}),/frozen target/);
  assert.throws(()=>call({frozenInspection:{...frozenInspection,target:{dirty:true,revision}}}),/frozen target/);
  assert.throws(()=>call({snapshotId:'sys_changed'}),/frozen target/);
});

test('rejects cross-control, unverified or broken human evidence lineage',()=>{
  assert.throws(()=>call({controlId:'ARL-KB-008'}),/frozen target/);
  assert.throws(()=>call({detail:{...detail,evidence:[{...reviewedEvidence,verificationState:'unverified'}]}}),/linked/);
  assert.throws(()=>call({detail:{...detail,evidence:[{...reviewedEvidence,sourceReference:'other'}]}}),/linked/);
});

test('disposition detection is scoped to project, control and exact snapshot',()=>{
  const event={projectId:'p1',controlId,systemSnapshotId:snapshotId,disposition:'inconclusive_documented'};
  const rows=[{properties_json:JSON.stringify(event)},{properties_json:'{bad'}];
  assert.equal(isInconclusiveReviewAlreadyDocumented(rows,{projectId:'p1',controlId,snapshotId}),true);
  assert.equal(isInconclusiveReviewAlreadyDocumented(rows,{projectId:'p1',controlId,snapshotId:'other'}),false);
  assert.equal(isInconclusiveReviewAlreadyDocumented(rows,{projectId:'p1',controlId:'ARL-KB-008',snapshotId}),false);
  assert.equal(isInconclusiveReviewAlreadyDocumented(rows,{projectId:'other',controlId,snapshotId}),false);
  assert.equal(isInconclusiveReviewAlreadyDocumented([{properties_json:JSON.stringify({...event,disposition:'approved'})}],{projectId:'p1',controlId,snapshotId}),false);
});
