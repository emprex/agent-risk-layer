import test from 'node:test';
import assert from 'node:assert/strict';
import { buildAssessmentBatchRunSummary } from '../src/agent/assessment-batch-run-summary.mjs';

const ids = Array.from({length:108},(_,i)=>'ARL-KB-'+String(i+1).padStart(3,'0'));
const item = (controlId)=>({controlId});
const snapshot = 'sys_test_108';
function fixture() {
  const queue = {
    complete:true,total:108,expectedTotal:108,controlIds:ids,
    systemSnapshotId:snapshot,securityStateChanged:false,
    deploymentDecisionWritten:false,humanReviewRequired:true,
    lanes:{
      follow_up_blocked:[],human_applicability:ids.slice(20).map(item),
      test_planning:ids.slice(0,20).map(item),evidence_collection:[],
      human_decision:[],review_required:[]
    }
  };
  const index = {
    systemSnapshotId:snapshot,eligibleControls:20,excludedControls:88,
    batchCount:1,batches:[{controlIds:ids.slice(0,20)}],
    securityStateChanged:false,deploymentDecisionWritten:false,humanReviewRequired:true
  };
  const review = {systemSnapshotId:snapshot,securityStateChanged:false,deploymentDecisionWritten:false};
  const preview = {
    schema:'arl.agent.static-collection-preview.v1',systemSnapshotId:snapshot,
    targetRevision:'a'.repeat(40),observationDigestSha256:'b'.repeat(64),
    counts:{requirements:1,criteria:1,metadataCandidates:0,missingStaticMetadata:1},
    criteria:[{controlId:ids[0],criterionSatisfied:false,evidenceVerified:false}],
    securityStateChanged:false,deploymentDecisionWritten:false,humanReviewRequired:true
  };
  return {queue,index,review,preview};
}
test('full batch reports all 108 controls without inventing a pass or evidence write',()=>{
  const summary=buildAssessmentBatchRunSummary(fixture());
  assert.equal(summary.controls.length,108);
  assert.equal(summary.eligibleControls,20);
  assert.equal(summary.excludedControls,88);
  assert.equal(summary.lanes.human_applicability,88);
  assert.ok(summary.controls.every(c=>c.result==='not_determined' && c.humanReviewRequired));
  assert.equal(summary.evidencePersisted,0);
  assert.equal(summary.testsExecuted,0);
  assert.equal(summary.passFailInferred,false);
});
test('batch refuses missing control, duplicate lane, or auto-verified criterion',()=>{
  const a=fixture();a.queue.controlIds.pop();
  assert.throws(()=>buildAssessmentBatchRunSummary(a),/108-control queue/);
  const b=fixture();b.queue.lanes.test_planning.push(item(ids[20]));
  assert.throws(()=>buildAssessmentBatchRunSummary(b),/Duplicate control/);
  const c=fixture();c.preview.criteria[0].criterionSatisfied=true;
  assert.throws(()=>buildAssessmentBatchRunSummary(c),/automatically verified/);
});
