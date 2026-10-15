import test from 'node:test';
import assert from 'node:assert/strict';
import {buildAssessmentBusinessContentInventory} from '../src/agent/assessment-business-content-inventory.mjs';
function fixture(){
 const revision='b'.repeat(40);
 const controls=Array.from({length:108},(_,i)=>({controlId:'ARL-KB-'+String(i+1).padStart(3,'0'),workflowLane:i<9?'human_decision':'test_planning',staticArtifacts:i<9?0:1,criteria:[]}));
 const report={schema:'arl.agent.assessment-client-report.v1',reportStatus:'draft_requires_accountable_human_review',projectId:'prj',systemSnapshotId:'sys',targetRevision:revision,controls,passFailInferred:false,evidenceAccepted:false,securityStateChanged:false,deploymentDecisionWritten:false};
 const details=controls.map(c=>({control:{id:c.controlId,title:'Control '+c.controlId,category:'Agent'},systemSnapshot:{id:'sys',assessmentConfiguration:{targetBinding:{revision}}},testDefinition:{objective:'Verify boundary',method:'Inspect config',requiredEvidence:['config'],passCondition:'Enforced',failCondition:'Bypassed',limitations:'No runtime'}}));
 return {report,details};
}
test('v7 inventory carries real business descriptions without inventing findings',()=>{
 const inventory=buildAssessmentBusinessContentInventory(fixture());
 assert.equal(inventory.controlsTotal,108);
 assert.equal(inventory.controls[0].title,'Control ARL-KB-001');
 assert.equal(inventory.controls[0].verifiedFindingClaims,0);
 assert.equal(inventory.controls[0].status,'requires_accountable_human_review');
 assert.equal(inventory.missingByField.objective.length,0);
});
test('v7 inventory rejects target drift and incomplete control detail',()=>{
 const a=fixture();a.details[0].systemSnapshot.id='other';
 assert.throws(()=>buildAssessmentBusinessContentInventory(a),/outside current frozen target/);
 const b=fixture();b.details.pop();
 assert.throws(()=>buildAssessmentBusinessContentInventory(b),/complete decision-free/);
});
