import test from 'node:test';
import assert from 'node:assert/strict';
import {buildAssessmentBatchReviewDossier} from '../src/agent/assessment-batch-review-dossier.mjs';

const ids=Array.from({length:108},(_,i)=>'ARL-KB-'+String(i+1).padStart(3,'0'));
function inputs() {
  const summary={schema:'arl.agent.assessment-batch-run-summary.v1',
    systemSnapshotId:'sys_test',targetRevision:'a'.repeat(40),observationDigestSha256:'b'.repeat(64),
    controlsTotal:108,eligibleControls:1,excludedControls:107,
    controls:ids.map((controlId,i)=>({controlId,lane:i?'human_decision':'test_planning',staticBatchEligible:i===0})),
    securityStateChanged:false,deploymentDecisionWritten:false,passFailInferred:false};
  const review={schema:'arl.agent.assessment-evidence-review-packs.v1',systemSnapshotId:'sys_test',
    staticCollection:[{tasks:[{controlId:ids[0],requirementIndex:1,requirement:'source-or-configuration',
      reviewState:'static_observation_candidate_review_required',candidateEvidenceIds:[],expectedCollectors:['repo']}]}],
    humanDocumentation:[],runtimeValidation:[],manualReview:[],lineageExceptions:[],
    securityStateChanged:false,deploymentDecisionWritten:false,
    boundaries:{evidenceAccepted:false,passFailInferred:false,runtimeTestingAuthorised:false}};
  const preview={schema:'arl.agent.static-collection-preview.v1',systemSnapshotId:'sys_test',
    targetRevision:'a'.repeat(40),observationDigestSha256:'b'.repeat(64),
    counts:{criteria:1,requirements:1,metadataCandidates:1,missingStaticMetadata:0},
    criteria:[{controlId:ids[0],requirementIndex:1,state:'static_metadata_collected_for_human_review',
      criterionSatisfied:false,evidenceVerified:false}],
    evidencePersisted:0,testsExecuted:0,passFailInferred:false};
  return {summary,review,preview};
}
test('review dossier retains all 108 controls and does not promote static candidates',()=>{
  const result=buildAssessmentBatchReviewDossier(inputs());
  assert.equal(result.controls.length,108);
  assert.equal(result.controls[0].requirements[0].evidenceVerified,false);
  assert.equal(result.controls[107].decision,'not_determined');
  assert.equal(result.evidencePersisted,0);
  assert.equal(result.passFailInferred,false);
});
test('review dossier rejects changed SHA, untrusted review boundary and missing static criterion',()=>{
  const a=inputs();a.preview.targetRevision='c'.repeat(40);
  assert.throws(()=>buildAssessmentBatchReviewDossier(a),/read-only authoritative/);
  const b=inputs();b.review.boundaries.evidenceAccepted=true;
  assert.throws(()=>buildAssessmentBatchReviewDossier(b),/read-only authoritative/);
  const c=inputs();c.preview.criteria=[];
  assert.throws(()=>buildAssessmentBatchReviewDossier(c),/Static criterion missing/);
});
