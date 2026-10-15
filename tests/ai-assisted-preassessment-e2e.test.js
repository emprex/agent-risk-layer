import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {buildAiAssistedPreassessment} from '../src/agent/ai-assisted-preassessment.mjs';
function dossier(){
 const digest='a'.repeat(64);
 const controls=Array.from({length:108},(_,i)=>{
  const controlId='ARL-KB-'+String(i+1).padStart(3,'0');
  return {controlId,title:'Scope '+i,category:'Tools',purpose:'Review tool boundaries',
   assessmentMethod:'Inspect scoped evidence',workflowLane:'test_planning',
   result:'undetermined',confirmedFinding:false,humanReviewRequired:true,nextStep:'Review',reviewRequirements:[{
    requirementIndex:1,expectedEvidence:'Approved tool source',
    artifactDigests:[digest],collectorTypes:['architecture_and_inventory'],
    boundedSourceFacts:[{collector:'architecture_and_inventory',artifactSha256:digest,values:{dependencyCount:3}}],
    proofStatus:'not_validated',requiresHumanDecision:true,acceptanceCriterion:'Human decision'
   }]};
 });
 return {schema:'arl.agent.assessment-action-dossiers.v1',projectId:'prj_test',snapshotId:'sys_test',
 targetRevision:'b'.repeat(40),controlsTotal:108,requirementsTotal:108,candidateRequirementCount:108,
 requiresEvidenceOrReviewCount:0,confirmedFindings:0,remediationPlansIssued:0,
 controls,humanReviewRequired:true,passFailInferred:false,evidenceAccepted:false,
 deploymentDecisionWritten:false,securityStateChanged:false};
}
test('entire AI report route produces immutable report containing scope-bound evidence',async()=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'arl-ai-e2e-'));
 try{
  const ask=async()=>({available:true,model:'synthetic',content:JSON.stringify({
   schema:'arl.ai.evidence-brief.v1',items:[{
    type:'observation',text:'Dependency count of three is present as static metadata.',
    factIds:['O1_1'],artifactSha256:['a'.repeat(64)]
   },{type:'verification',text:'Check approved source records for this control.',
    factIds:['R1'],artifactSha256:[]}]
  })});
  const r=await buildAiAssistedPreassessment({dossier:dossier(),outputDirectory:root,ask});
  assert.equal(r.available,true);
  assert.equal(r.advisoryControlIds.length,3);
  assert.equal(r.securityStateChanged,false);
  const html=fs.readFileSync(r.file,'utf8');
  assert.match(html,/AI-assisted evidence review/);
  assert.match(html,/Dependency count of three/);
  assert.match(html,/Source SHA-256/);
  assert.match(html,/Operator review only/);
  assert.equal(fs.readdirSync(root).length,1);
 }finally{fs.rmSync(root,{recursive:true,force:true});}
});
test('unavailable local model never creates misleading AI-assisted report',async()=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'arl-ai-noop-'));
 try{
  const r=await buildAiAssistedPreassessment({dossier:dossier(),outputDirectory:root,
   ask:async()=>({available:false,reason:'ollama_unavailable'})});
  assert.equal(r.available,false);
  assert.equal(r.reportWritten,false);
  assert.equal(r.failures.length,3);
  assert.deepEqual(fs.readdirSync(root),[]);
 }finally{fs.rmSync(root,{recursive:true,force:true});}
});

test('one-control pilot performs only KB-007 inference and never calls the other two',async()=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'arl-ai-one-'));
 let calls=0;
 try{
  const response=JSON.stringify({schema:'arl.ai.evidence-brief.v1',items:[{
   type:'observation',text:'Three dependency metadata references were observed.',
   factIds:['O1_1'],artifactSha256:['a'.repeat(64)]
  }]});
  const result=await buildAiAssistedPreassessment({
   dossier:dossier(),outputDirectory:root,controlIds:['ARL-KB-007'],
   ask:async()=>{calls++;return {available:true,content:response};}
  });
  assert.equal(calls,1);
  assert.equal(result.available,true);
  assert.deepEqual(result.advisoryControlIds,['ARL-KB-007']);
 }finally{fs.rmSync(root,{recursive:true,force:true});}
});
