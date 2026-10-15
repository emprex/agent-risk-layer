import test from 'node:test';
import assert from 'node:assert/strict';
import {buildAssessmentClientReport} from '../src/agent/assessment-client-report.mjs';
const ids=Array.from({length:108},(_,i)=>'ARL-KB-'+String(i+1).padStart(3,'0'));
function fixture() {
  const excluded=new Set(['ARL-KB-001','ARL-KB-002','ARL-KB-003','ARL-KB-004','ARL-KB-005','ARL-KB-046','ARL-KB-057','ARL-KB-090','ARL-KB-100']);
  const controls=ids.map(controlId=>({
    controlId,lane:excluded.has(controlId)?'human_decision':'test_planning',
    eligible:!excluded.has(controlId),decision:'not_determined',
    status:'human_review_required',requirements:[],lineageExceptions:[]
  }));
  const dossier={schema:'arl.agent.assessment-batch-review-dossier.v1',
    systemSnapshotId:'sys-test',targetRevision:'a'.repeat(40),
    scope:{controls:108},controls,
    passFailInferred:false,securityStateChanged:false,deploymentDecisionWritten:false};
  const audit={schema:'arl.agent.assessment-static-integrity-audit.v1',
    projectId:'prj-test',snapshotId:'sys-test',targetRevision:'a'.repeat(40),
    controlsTotal:108,eligibleWithArtifacts:99,storedArtifactCount:102,
    artifactIntegrityVerified:true,controlsWithIntegrityFailures:[],
    eligibleMissingArtifacts:[],excludedControls:controls.filter(c=>!c.eligible)
      .map(c=>({controlId:c.controlId})),
    controls:controls.map(c=>({controlId:c.controlId,lane:c.lane,
      storedArtifacts:c.eligible?1:0,integrity:c.eligible?'verified_artifact_integrity_only':'no_artifact'})),
    passFailInferred:false,evidenceAccepted:false,securityStateChanged:false,
    deploymentDecisionWritten:false};
  return {dossier,audit};
}
test('client draft explicitly accounts for 108, 99 and 9 without PASS/FAIL',()=>{
  const report=buildAssessmentClientReport(fixture());
  assert.equal(report.controls.length,108);
  assert.equal(report.summary.decisionStageControls,9);
  assert.equal(report.summary.controlsWithStaticArtifacts,99);
  assert.equal(report.summary.controlsSecurityValidated,0);
  assert.equal(report.reportStatus,'draft_requires_accountable_human_review');
  assert.ok(report.controls.every(c=>c.assessmentResult==='not_determined'));
});
test('client draft rejects integrity and authorization drift',()=>{
  const a=fixture();a.audit.artifactIntegrityVerified=false;
  assert.throws(()=>buildAssessmentClientReport(a),/cryptographically checked/);
  const b=fixture();b.dossier.controls[0].decision='pass';
  assert.throws(()=>buildAssessmentClientReport(b),/mismatched control workflow/);
  const c=fixture();c.audit.excludedControls.pop();
  assert.throws(()=>buildAssessmentClientReport(c),/excludes or misstates/);
});
