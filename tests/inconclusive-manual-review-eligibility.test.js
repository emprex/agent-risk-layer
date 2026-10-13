import test from 'node:test';
import assert from 'node:assert/strict';
import { requireInconclusiveReviewEvidence } from '../src/agent/inconclusive-review-eligibility.mjs';

const sha='a'.repeat(40), snapshotId='sys_test', controlId='ARL-KB-011';
function input(sourceType='manual_review') {
  const sourceReference='human:review-011';
  return {
    snapshotId,revision:sha,controlId,
    frozenInspection:{binding:{verified:true,revisionBefore:sha,revisionAfter:sha},target:{dirty:false}},
    detail:{
      control:{id:controlId},systemSnapshot:{id:snapshotId,assessmentConfiguration:{targetBinding:{revision:sha}}},
      chain:{currentStage:'test',status:'test_inconclusive'},
      tests:[{id:'ctx_1',systemSnapshotId:snapshotId,controlId,result:'inconclusive',executionMethod:sourceType,inputReference:sourceReference}],
      evidence:[{id:'cei_1',systemSnapshotId:snapshotId,controlId,retentionStatus:'active',verificationState:'verified',sourceType,evidenceClass:'human_provided',testExecutionId:'ctx_1',sourceReference}]
    }
  };
}
for(const kind of ['manual_review','consolidated_human_review']){
  test('allows verified, linked inconclusive '+kind,()=>assert.equal(requireInconclusiveReviewEvidence(input(kind)).id,'cei_1'));
}
test('rejects mismatched execution method',()=>{
  const args=input();args.detail.tests[0].executionMethod='consolidated_human_review';
  assert.throws(()=>requireInconclusiveReviewEvidence(args),/verified human review/);
});
test('rejects an unverified record',()=>{
  const args=input();args.detail.evidence[0].verificationState='unverified';
  assert.throws(()=>requireInconclusiveReviewEvidence(args),/verified human review/);
});
test('rejects mismatched snapshot or changed target',()=>{
  const args=input();args.detail.evidence[0].systemSnapshotId='sys_old';
  assert.throws(()=>requireInconclusiveReviewEvidence(args),/verified human review/);
  const dirty=input();dirty.frozenInspection.target.dirty=true;
  assert.throws(()=>requireInconclusiveReviewEvidence(dirty),/clean frozen target/);
});
test('rejects a passed or failed security control',()=>{
  for(const status of ['passed','failed']){
    const args=input();args.detail.chain.status=status;
    assert.throws(()=>requireInconclusiveReviewEvidence(args),/inconclusive test-stage/);
  }
});
test('rejects a test not marked inconclusive',()=>{
  const args=input();args.detail.tests[0].result='passed';
  assert.throws(()=>requireInconclusiveReviewEvidence(args),/verified human review/);
});
