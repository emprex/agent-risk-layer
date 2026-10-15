import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {renderClientPreassessment,writeClientPreassessment} from '../src/agent/client-preassessment-export.mjs';
function fixture(){
 const controls=Array.from({length:108},(_,i)=>({controlId:'ARL-KB-'+String(i+1).padStart(3,'0'),title:'Review <policy> '+i,category:'Governance',purpose:'Verify authority '+i,assessmentMethod:'Compare approved evidence with configuration',workflowLane:i<9?'human_decision':'test_planning',result:'undetermined',confirmedFinding:false,nextStep:'Review source and scope',reviewRequirements:[{expectedEvidence:'Risk owner record '+i,artifactDigests:i<9?[]:['f'.repeat(64)],collectorTypes:['source_and_configuration'],proofStatus:'not_validated',requiresHumanDecision:true,acceptanceCriterion:'Recorded accountable review'}]}));
 return {schema:'arl.agent.assessment-action-dossiers.v1',projectId:'prj_demo',snapshotId:'sys_demo',targetRevision:'a'.repeat(40),controlsTotal:108,requirementsTotal:108,candidateRequirementCount:99,requiresEvidenceOrReviewCount:9,confirmedFindings:0,remediationPlansIssued:0,controls,humanReviewRequired:true,passFailInferred:false,evidenceAccepted:false,deploymentDecisionWritten:false,securityStateChanged:false};
}
test('produces human-readable evidence report with 108 detailed review items and no false vulnerability statements',()=>{
 const html=renderClientPreassessment(fixture());
 assert.match(html,/Executive|What the client should do next/);
 assert.match(html,/Review &lt;policy&gt; 6/);
 assert.match(html,/Risk owner record 6/);
 assert.match(html,/No confirmed security findings/);
 assert.doesNotMatch(html,/Review <policy>/);
 assert.equal((html.match(/class="control" id=/g)||[]).length,108);
});
test('exports immutable, private, digest-named files and preserves prior bytes',()=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'arl-client-'));
 try{
  const a=writeClientPreassessment({dossier:fixture(),outputDirectory:root});
  const b=writeClientPreassessment({dossier:fixture(),outputDirectory:root});
  assert.equal(a.file,b.file);assert.equal(b.status,'already_present_identical');
  assert.equal(fs.statSync(a.file).mode&0o777,0o600);
  const modified=fixture();modified.controls[0].title='Changed description';
  const c=writeClientPreassessment({dossier:modified,outputDirectory:root});
  assert.notEqual(a.file,c.file);
  assert.equal(fs.readdirSync(root).length,2);
 }finally{fs.rmSync(root,{recursive:true,force:true});}
});
test('rejects security-authority escalation',()=>{
 const a=fixture();a.confirmedFindings=1;
 assert.throws(()=>renderClientPreassessment(a),/requires complete/);
 const b=fixture();b.controls[0].confirmedFinding=true;
 assert.throws(()=>renderClientPreassessment(b),/requires complete/);
});

test('renders isolated AI advisory annex with escaped content and retains strict authority',()=>{
 const d=fixture();
 const digest='f'.repeat(64);
 d.controls[9].reviewRequirements[0].boundedSourceFacts=[{collector:'source_and_configuration',artifactSha256:digest,values:{dependencyCount:2}}];
 const a={controlId:'ARL-KB-010',projectId:d.projectId,snapshotId:d.snapshotId,targetRevision:d.targetRevision,advisoryOnly:true,humanReviewRequired:true,
 confirmedFinding:false,evidenceAccepted:false,securityStateChanged:false,
 deploymentDecisionWritten:false,structuredItems:[{type:'observation',
 text:'Candidate <script>alert(1)</script> metadata only',factIds:['O1_1'],artifactSha256:[digest]}]};
 const report=renderClientPreassessment(d,{advisories:[a]});
 assert.match(report,/AI-assisted evidence review/);
 assert.match(report,/Operator review only/);
 assert.match(report,/&lt;script&gt;/);
 assert.doesNotMatch(report,/<script>alert/);
 const bad={...a,confirmedFinding:true};
 assert.throws(()=>renderClientPreassessment(d,{advisories:[bad]}),/AI advisory annex/);
});

test('rejects stale snapshot, foreign project and injected source digest in AI report annex',()=>{
 const d=fixture();
 const digest='f'.repeat(64);
 d.controls[9].reviewRequirements[0].boundedSourceFacts=[{collector:'source_and_configuration',artifactSha256:digest,values:{dependencyCount:2}}];
 const item={type:'observation',text:'Two dependency metadata references were recorded.',factIds:['O1_1'],artifactSha256:[digest]};
 const a={controlId:'ARL-KB-010',projectId:d.projectId,snapshotId:d.snapshotId,targetRevision:d.targetRevision,
 advisoryOnly:true,humanReviewRequired:true,confirmedFinding:false,evidenceAccepted:false,securityStateChanged:false,deploymentDecisionWritten:false,structuredItems:[item]};
 assert.match(renderClientPreassessment(d,{advisories:[a]}),/Two dependency metadata references/);
 assert.throws(()=>renderClientPreassessment(d,{advisories:[{...a,snapshotId:'sys_old'}]}),/AI advisory annex/);
 assert.throws(()=>renderClientPreassessment(d,{advisories:[{...a,projectId:'prj_foreign'}]}),/AI advisory annex/);
 assert.throws(()=>renderClientPreassessment(d,{advisories:[{...a,targetRevision:'b'.repeat(40)}]}),/AI advisory annex/);
 assert.throws(()=>renderClientPreassessment(d,{advisories:[{...a,structuredItems:[{...item,artifactSha256:['a'.repeat(64)]}]}]}),/AI advisory annex/);
});

test('executive summary surfaces only collected bounded facts and evidence tasks',()=>{
 const d=fixture();
 d.controls[9].reviewRequirements[0].boundedSourceFacts=[{collector:'architecture_and_inventory',artifactSha256:'f'.repeat(64),values:{dependencyCount:13,observedTechnologies:['node']}}];
 const html=renderClientPreassessment(d);
 assert.match(html,/Evidence-led review starting points/);
 assert.match(html,/dependencyCount/);
 assert.match(html,/Next evidence check/);
 assert.match(html,/Governance records requiring human review/);
 assert.doesNotMatch(html,/high-risk vulnerability/i);
});
