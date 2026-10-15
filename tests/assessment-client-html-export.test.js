import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {renderAssessmentClientHtml,writeAssessmentClientHtml} from '../src/agent/assessment-client-html-export.mjs';
function fixture(){
 const controls=Array.from({length:108},(_,i)=>({controlId:'ARL-KB-'+String(i+1).padStart(3,'0'),workflowLane:i<9?'human_decision':'test_planning',staticArtifacts:i<9?0:1,artifactIntegrity:'verified_artifact_integrity_only',assessmentResult:'not_determined',nextAction:'Human review',lineageExceptionCount:0,criteria:[{index:1,kind:'<script>alert(1)</script>',reviewState:'pending',staticMetadataState:null}]}));
 return {schema:'arl.agent.assessment-client-report.v1',reportStatus:'draft_requires_accountable_human_review',humanReviewRequired:true,evidenceAccepted:false,passFailInferred:false,securityStateChanged:false,deploymentDecisionWritten:false,targetRevision:'a'.repeat(40),projectId:'proj',systemSnapshotId:'snapshot',summary:{totalControls:108,controlsWithStaticArtifacts:99,decisionStageControls:9,sourceArtifactsIntegrityChecked:102},controls,limitations:['Unverified evidence']};
}
test('HTML report contains 108 controls, escapes injection and enforces human review',()=>{
 const html=renderAssessmentClientHtml(fixture());
 assert.equal((html.match(/class="control"/g)||[]).length,108);
 assert.ok(html.includes('&lt;script&gt;alert(1)&lt;/script&gt;'));
 assert.ok(!html.includes('<script>alert(1)</script>'));
 assert.ok(html.includes('DRAFT'));
 const incomplete=fixture();incomplete.controls.pop();
 assert.throws(()=>renderAssessmentClientHtml(incomplete),/complete/);
});
test('HTML export is local, idempotent and never overwrites changed output',()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'arl-html-'));
 try{
   const r=fixture();const first=writeAssessmentClientHtml({report:r,outputDirectory:dir});
   assert.equal(first.status,'created');
   assert.equal(writeAssessmentClientHtml({report:r,outputDirectory:dir}).status,'already_present_identical');
   fs.appendFileSync(first.file,'changed');
   assert.throws(()=>writeAssessmentClientHtml({report:r,outputDirectory:dir}),/refusing overwrite/);
 }finally{fs.rmSync(dir,{recursive:true,force:true});}
});
