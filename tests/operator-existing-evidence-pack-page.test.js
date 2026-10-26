import test from 'node:test';
import assert from 'node:assert/strict';
import {
  existingEvidencePackPage
} from '../src/agent/existing-evidence-pack-page.mjs';

const revision='a'.repeat(40);
const scope={
  available:true,projectId:'prj_test',systemSnapshotId:'sys_test',
  targetBinding:{revision},securityStateChanged:false,
  deploymentDecisionWritten:false,humanReviewRequired:true
};
const task={
  controlId:'ARL-KB-019',requirementIndex:1,
  requirement:'Synthetic requirement',reviewState:'static_observation_missing',
  candidateEvidenceIds:[],expectedCollectors:['source_and_configuration']
};
const requests={canonicalData:{
  securityStateChanged:false,deploymentDecisionWritten:false,
  humanReviewRequired:true,assessmentEvidenceRequestPack:{
    snapshotId:'sys_test',packNumber:1,packCount:2,
    pageNumber:1,pageCount:2,taskCount:21,
    controlSpecificReviewTasks:[task],
    securityStateChanged:false,deploymentDecisionWritten:false,
    humanReviewRequired:true
  }
}};
const input=()=>({
  frozenRevision:revision,
  binding:{projectId:'prj_test',assessmentId:'asmt_test'},
  scopeBefore:structuredClone(scope),scopeAfter:structuredClone(scope),
  requests:structuredClone(requests),packNumber:1
});

test('evidence pack is bounded and strips source identifiers',()=>{
  const source=input();
  source.requests.canonicalData.assessmentEvidenceRequestPack
    .controlSpecificReviewTasks[0].candidateEvidenceIds=['private-evidence-1'];
  const out=existingEvidencePackPage(source);
  assert.equal(out.schema,'arl.operator.existing-evidence-pack-page.v1');
  assert.equal(out.tasks[0].candidateCount,1);
  assert.deepEqual(out.tasks[0].expectedCollectors,['source_and_configuration']);
  assert.equal(out.tasks[0].requirement,'Synthetic requirement');
  assert.equal(out.evidenceAccepted,false);
  assert.equal(out.humanReviewRequired,true);
  assert.equal(JSON.stringify(out).includes('private-evidence-1'),false);
});

test('stale revision, forged verdict and mismatched pack are rejected',()=>{
  for(const kind of ['revision','decision','number','task']){
    const source=input();
    if(kind==='revision')source.scopeAfter.targetBinding.revision='b'.repeat(40);
    if(kind==='decision')source.requests.canonicalData.humanReviewRequired=false;
    if(kind==='number')source.requests.canonicalData.assessmentEvidenceRequestPack.packNumber=2;
    if(kind==='task')source.requests.canonicalData.assessmentEvidenceRequestPack
      .controlSpecificReviewTasks[0].reviewState='verified';
    assert.throws(()=>existingEvidencePackPage(source),Error);
  }
});

test('canonical second page remains read only and exact-page bound',()=>{
  const source=input();
  source.pageNumber=2;
  source.requests.canonicalData.assessmentEvidenceRequestPack.pageNumber=2;
  const result=existingEvidencePackPage(source);
  assert.equal(result.pageNumber,2);
  assert.equal(result.evidenceAccepted,false);
  source.requests.canonicalData.assessmentEvidenceRequestPack.pageNumber=1;
  assert.throws(()=>existingEvidencePackPage(source),Error);
  source.requests.canonicalData.assessmentEvidenceRequestPack.pageNumber=2;
  source.requests.canonicalData.assessmentEvidenceRequestPack.pageCount=1;
  assert.throws(()=>existingEvidencePackPage(source),Error);
});

test('expected collectors are bounded metadata, not observed evidence',()=>{
  const source=input();
  const row=source.requests.canonicalData.assessmentEvidenceRequestPack
    .controlSpecificReviewTasks[0];
  row.expectedCollectors=['source_and_configuration','source_and_configuration'];
  const out=existingEvidencePackPage(source);
  assert.deepEqual(out.tasks[0].expectedCollectors,['source_and_configuration']);
  assert.equal(out.evidenceAccepted,false);
  row.expectedCollectors=['../not_a_collector'];
  assert.throws(()=>existingEvidencePackPage(source),Error);
  row.expectedCollectors=Array.from({length:17},()=> 'collector');
  assert.throws(()=>existingEvidencePackPage(source),Error);
});
