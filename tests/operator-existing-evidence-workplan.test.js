import test from 'node:test';
import assert from 'node:assert/strict';
import { existingEvidenceWorkplan, EXISTING_EVIDENCE_SUMMARY_SCHEMA }
  from '../src/agent/existing-evidence-workplan.mjs';

const SHA='a'.repeat(40);
const binding={projectId:'prj_synthetic',assessmentId:'asmt_synthetic'};
const scope={
  available:true,projectId:binding.projectId,systemSnapshotId:'sys_synthetic',
  targetBinding:{revision:SHA},securityStateChanged:false,
  deploymentDecisionWritten:false,humanReviewRequired:true
};
const summary={
  snapshotId:'sys_synthetic',controlsReviewed:98,excludedControls:10,criterionCount:416,
  summary:{
    staticCandidates:25,staticMissing:197,humanRequirements:119,
    runtimeRequirements:191,sourceLineageIssues:5,
    staticSourcePackets:1,humanDocumentPackets:1,
    runtimeValidationPackets:1,manualReviewPackets:0
  },
  packs:[
    {number:1,theme:'untrusted_collector_SECRETVALUE',taskCount:197,controlCount:71},
    {number:2,theme:'untrusted_human',taskCount:119,controlCount:64},
    {number:3,theme:'runtime',taskCount:191,controlCount:83}
  ],
  activeLineageExceptions:[{secret:'CUSTOMER_UNTRUSTED_EVIDENCE'}]
};
const requests={
  canonicalData:{
    assessmentEvidenceRequestSummary:summary,
    securityStateChanged:false,deploymentDecisionWritten:false,humanReviewRequired:true
  }
};
const input={frozenRevision:SHA,binding,scopeBefore:scope,scopeAfter:scope,requests};

test('read-only canonical evidence workplan exposes only bounded counts and work pack identifiers',()=>{
  const out=existingEvidenceWorkplan(input);
  assert.equal(out.schema,EXISTING_EVIDENCE_SUMMARY_SCHEMA);
  assert.equal(out.available,true);
  assert.equal(out.assessmentControls,98);
  assert.equal(out.otherWorkflowControls,10);
  assert.equal(out.criterionCount,416);
  assert.deepEqual(out.packs.map(x=>x.category),[
    'static_observation','human_document','runtime_authorisation'
  ]);
  assert.equal(out.evidenceAccepted,false);
  assert.equal(out.testsExecuted,0);
  assert.equal(out.passFailInferred,false);
  assert.equal(out.readinessDecision,'not_evaluated');
  assert.doesNotMatch(JSON.stringify(out),/SECRETVALUE|CUSTOMER_UNTRUSTED_EVIDENCE|untrusted_human/);
});
test('missing binding is never bootstrapped or interpreted as completed review',()=>{
  const out=existingEvidenceWorkplan({frozenRevision:SHA});
  assert.equal(out.available,false);
  assert.equal(out.reason,'not_found');
  assert.equal(out.humanReviewRequired,true);
});
test('evidence workplan refuses altered target, snapshot or authority flags',()=>{
  for(const variant of [
    {scopeAfter:{...scope,systemSnapshotId:'sys_other'}},
    {scopeAfter:{...scope,targetBinding:{revision:'b'.repeat(40)}}},
    {scopeBefore:{...scope,projectId:'prj_other'}},
    {requests:{canonicalData:{...requests.canonicalData,securityStateChanged:true}}},
    {requests:{canonicalData:{...requests.canonicalData,assessmentEvidenceRequestSummary:{
      ...summary,snapshotId:'sys_foreign'}}}},
    {requests:{canonicalData:{...requests.canonicalData,assessmentEvidenceRequestSummary:{
      ...summary,excludedControls:9}}}},
    {requests:{canonicalData:{...requests.canonicalData,assessmentEvidenceRequestSummary:{
      ...summary,summary:{...summary.summary,staticSourcePackets:2}}}}},
    {requests:{canonicalData:{...requests.canonicalData,assessmentEvidenceRequestSummary:{
      ...summary,packs:[...summary.packs.slice(0,2),{...summary.packs[2],number:8}]}}}}
  ]){
    assert.throws(()=>existingEvidenceWorkplan({...input,...variant}));
  }
});
