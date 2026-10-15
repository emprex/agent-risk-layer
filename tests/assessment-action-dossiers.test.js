import test from 'node:test';
import assert from 'node:assert/strict';
import {buildAssessmentActionDossiers} from '../src/agent/assessment-action-dossiers.mjs';
function inputs(){
 const controls=Array.from({length:108},(_,i)=>({controlId:'ARL-KB-'+String(i+1).padStart(3,'0'),title:'Boundary '+i,workflowLane:i<9?'human_decision':'test_planning',requirements:[{requirementIndex:1,requirement:'Verified governance record '+i,observationState:i<9?'no_exact_static_metadata_match':'static_metadata_candidate',sourceArtifactSha256:i<9?[]:['a'.repeat(64)],observedCollectorTypes:i<9?[]:['source_and_configuration'],evidenceValidated:false,requirementSatisfied:false}]}));
 const a={schema:'arl.agent.assessment-evidence-requirement-map.v1',projectId:'prj',snapshotId:'sys',targetRevision:'a'.repeat(40),controlsTotal:108,requirementsTotal:108,matchedRequirements:99,unmatchedRequirements:9,controls,passFailInferred:false,evidenceAccepted:false,deploymentDecisionWritten:false,securityStateChanged:false};
 const b={schema:'arl.agent.assessment-business-content-inventory.v1',projectId:'prj',snapshotId:'sys',targetRevision:'a'.repeat(40),controlsTotal:108,controls:controls.map(c=>({controlId:c.controlId,title:c.title,category:'Scope',objective:'Examine human authority',method:'Review primary records',passCondition:'Authorised',failCondition:'Unauthorised',limitations:'Needs review',workflowLane:c.workflowLane,requiredEvidence:c.requirements.map(r=>r.requirement)})),passFailInferred:false,evidenceAccepted:false};
 return {mapping:a,inventory:b};
}
test('all controls get precise review actions without inferred vulnerabilities',()=>{
 const d=buildAssessmentActionDossiers(inputs());
 assert.equal(d.controls.length,108);
 assert.equal(d.confirmedFindings,0);
 assert.equal(d.remediationPlansIssued,0);
 assert.equal(d.controls[0].reviewRequirements[0].actionType,'accountable_human_review');
 assert.equal(d.controls[9].reviewRequirements[0].actionType,'inspect_candidate_and_validate_source');
 assert.equal(d.controls[9].confirmedFinding,false);
 assert.equal(d.controls[9].reviewRequirements[0].proofStatus,'not_validated');
});
test('rejects scope drift, missing evidence and automated validation',()=>{
 const a=inputs();a.inventory.targetRevision='b'.repeat(40);
 assert.throws(()=>buildAssessmentActionDossiers(a),/same-scope/);
 const b=inputs();b.mapping.controls[9].requirements[0].evidenceValidated=true;
 assert.throws(()=>buildAssessmentActionDossiers(b),/accepted evidence/);
 const c=inputs();c.mapping.controls[9].requirements[0].sourceArtifactSha256=[];
 assert.throws(()=>buildAssessmentActionDossiers(c),/Candidate requires/);
});
