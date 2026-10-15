import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {renderClientPreassessment,writeClientPreassessment} from '../src/agent/client-preassessment-export.mjs';
import {buildClientEvidenceSummary} from '../src/agent/client-evidence-summary.mjs';
function fixture(){
 const controls=Array.from({length:108},(_,i)=>({controlId:'ARL-KB-'+String(i+1).padStart(3,'0'),title:'Review <policy> '+i,category:'Governance',purpose:'Verify authority '+i,assessmentMethod:'Compare approved evidence with configuration',workflowLane:i<9?'human_decision':'test_planning',result:'undetermined',confirmedFinding:false,humanReviewRequired:true,nextStep:'Review source and scope',reviewRequirements:[{expectedEvidence:'Risk owner record '+i,artifactDigests:i<9?[]:['f'.repeat(64)],collectorTypes:['source_and_configuration'],proofStatus:'not_validated',requiresHumanDecision:true,acceptanceCriterion:'Recorded accountable review'}]}));
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

test('KB-007 shows concrete provider candidates but never asserts activation',()=>{
 const d=fixture();
 const control=d.controls[6];
 control.reviewRequirements[0].artifactDigests=['a'.repeat(64)];
 control.reviewRequirements[0].boundedSourceFacts=[{
  collector:'architecture_and_inventory',artifactSha256:'a'.repeat(64),
  values:{providerPackageCandidates:['anthropic','langchain','fastmcp'],
   discoveryCoverage:{completeTrackedAndTextScan:false}}
 }];
 const html=renderClientPreassessment(d);
 assert.match(html,/ARL-KB-007 — Third-party providers/);
 assert.match(html,/anthropic, fastmcp, langchain/);
 assert.match(html,/do not prove runtime use, approval/);
 assert.match(html,/inventory scan was capped or incomplete/);
 assert.match(html,/Reconcile candidate packages against active runtime providers/);
});

test('focused review separates evidence, uncertainty and next verification',()=>{
 const d=fixture();
 d.controls[6].reviewRequirements[0].artifactDigests=['a'.repeat(64)];
 d.controls[6].reviewRequirements[0].boundedSourceFacts=[{
  artifactSha256:'a'.repeat(64),collector:'architecture_and_inventory',
  values:{providerPackageCandidates:['anthropic'],discoveryCoverage:{completeTrackedAndTextScan:false}}
 }];
 const html=renderClientPreassessment(d);
 assert.equal((html.match(/Observed — static collection/g)||[]).length,3);
 assert.equal((html.match(/Unverified — evidence limits/g)||[]).length,3);
 assert.equal((html.match(/Next security verification — evidence or authorised tests/g)||[]).length,3);
 assert.match(html,/do not prove runtime use, approval, data transfer/);
 assert.match(html,/No verified MCP\/tool-reference count is available/);
 assert.match(html,/The inventory scan was capped or incomplete/);
 assert.match(html,/they do not imply any successful attack or confirmed policy failure/i);
});

test('preassessment and executive summary exclude foreign and unbound source facts',()=>{
 const d=fixture(),digest='f'.repeat(64),foreign='a'.repeat(64);
 const control=d.controls[9],first=control.reviewRequirements[0];
 first.boundedSourceFacts=[
  {collector:'approved_candidate',artifactSha256:digest,values:{dependencyCount:2}},
  {collector:'foreign_digest',artifactSha256:foreign,values:{dependencyCount:999}}
 ];
 control.reviewRequirements.push({
  requirementIndex:2,expectedEvidence:'Unmatched independent requirement',
  artifactDigests:[],boundedSourceFacts:[
   {collector:'unbound_sibling',artifactSha256:digest,values:{dependencyCount:888}}
  ],proofStatus:'not_validated',requiresHumanDecision:true,
  acceptanceCriterion:'Human independent decision'
 });
 const html=renderClientPreassessment(d);
 assert.match(html,/approved_candidate/);
 assert.match(html,/dependencyCount.*2/);
 assert.doesNotMatch(html,/foreign_digest|unbound_sibling|dependencyCount.*999|dependencyCount.*888/);
 assert.match(html,/Unmatched independent requirement/);
 assert.match(html,/blocked_no_verified_rules_of_engagement/);
 assert.match(html,/No confirmed security findings/);
 const summary=buildClientEvidenceSummary(d);
 const focused=summary.technical.find(x=>x.controlId==='ARL-KB-010');
 assert.equal(focused.sourceFacts.length,1);
 assert.deepEqual(focused.sourceFacts[0].digest,digest);
 assert.equal(focused.missingCount,1);
});
test('invalid artifact digest is not counted or rendered as collected evidence',()=>{
 const d=fixture();
 const requirement=d.controls[9].reviewRequirements[0];
 requirement.artifactDigests=['not-a-sha256'];
 requirement.boundedSourceFacts=[{
  collector:'invalid_fact',artifactSha256:'not-a-sha256',values:{dependencyCount:1234}
 }];
 const html=renderClientPreassessment(d);
 assert.doesNotMatch(html,/invalid_fact|not-a-sha256|dependencyCount.*1234/);
 assert.match(html,/<b>98<\/b>Requirements with candidate metadata/);
 assert.match(html,/<b>10<\/b>Requirements needing more evidence or review/);
 assert.match(html,/No exact static metadata match/);
});

test('report shows capped bounded-scan warning only for its own requirement',()=>{
 const d=fixture(), c=d.controls[9],digest='f'.repeat(64);
 c.reviewRequirements[0].boundedSourceFacts=[{
  collector:'architecture_and_inventory',artifactSha256:digest,
  values:{discoveryCoverage:{trackedFileScanCapped:true}}
 }];
 c.reviewRequirements.push({
  requirementIndex:2,expectedEvidence:'Separate decision record',
  artifactDigests:[],boundedSourceFacts:[],
  proofStatus:'not_validated',requiresHumanDecision:true,
  acceptanceCriterion:'Accountable reviewer decision'
 });
 const html=renderClientPreassessment(d);
 assert.equal((html.match(/Coverage limitation:<\/strong> The bounded source scan/g)||[]).length,1);
 assert.match(html,/Separate decision record/);
 assert.match(html,/No exact static metadata match/);
});
