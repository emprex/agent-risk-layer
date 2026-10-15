import test from 'node:test';
import assert from 'node:assert/strict';
import {buildControlVerificationPlan,buildAssessmentVerificationPlans} from '../src/agent/control-verification-plans.mjs';

const A='a'.repeat(64),B='b'.repeat(64),C='c'.repeat(64);
function makeDossier(projectId='prj_one',snapshotId='sys_one',targetRevision='d'.repeat(40)){
 const requirement=(index,evidence,digests=[],facts=[])=>({
  requirementIndex:index,expectedEvidence:evidence,artifactDigests:digests,
  boundedSourceFacts:facts,proofStatus:'not_validated',requiresHumanDecision:true,
  acceptanceCriterion:'Human assessor records primary evidence and scoped outcome.'
 });
 const controls=[
  {controlId:'ARL-KB-021',title:'Tool access',purpose:'Review MCP tools',
   assessmentMethod:'Inspect effective tool scopes',workflowLane:'test_planning',
   result:'undetermined',confirmedFinding:false,humanReviewRequired:true,
   reviewRequirements:[
    requirement(1,'Versioned MCP tool catalog',[A],[{collector:'architecture_and_inventory',
     artifactSha256:A,values:{mcpAndToolReferenceFilesCount:4,
      discoveryCoverage:{trackedFileScanCapped:true}}},{collector:'foreign',
     artifactSha256:B,values:{mcpAndToolReferenceFilesCount:900}}]),
    requirement(2,'Effective permission grants',[],[{collector:'unbound',
     artifactSha256:A,values:{workloadIdentityCandidateCount:777}}])
   ]},
  {controlId:'ARL-KB-082',title:'Audit evidence',category:'Governance and scope',purpose:'Review telemetry',
   assessmentMethod:'Correlate audit events',workflowLane:'human_decision',
   result:'undetermined',confirmedFinding:false,humanReviewRequired:true,
   reviewRequirements:[requirement(1,'Timestamped audit record',[C],
    [{collector:'source_and_configuration',artifactSha256:C,values:{policyArtifactsCount:1}}])]}
 ];
 return {schema:'arl.agent.assessment-action-dossiers.v1',
  projectId,snapshotId,targetRevision,controlsTotal:2,confirmedFindings:0,
  controls,humanReviewRequired:true,passFailInferred:false,evidenceAccepted:false,
  securityStateChanged:false,deploymentDecisionWritten:false};
}
test('technical verification plan binds observations to the exact requirement and scope',()=>{
 const d=makeDossier();
 const p=buildControlVerificationPlan(d,'ARL-KB-021');
 assert.equal(p.schema,'arl.agent.control-verification-plan.v1');
 assert.equal(p.projectId,d.projectId);assert.equal(p.snapshotId,d.snapshotId);
 assert.equal(p.targetRevision,d.targetRevision);
 assert.equal(p.coverage.candidateRequirements,1);
 assert.equal(p.coverage.limitedCoverage,true);
 const [r1,r2]=p.requirements;
 assert.deepEqual(r1.observed.artifactSha256,[A]);
 assert.equal(r1.observed.boundedSourceFacts.length,1);
 assert.equal(r1.observed.boundedSourceFacts[0].artifactSha256,A);
 assert.match(r1.verification.technical,/registry|tool/);
 assert.equal(r2.evidenceState,'no_matching_static_metadata');
 assert.deepEqual(r2.observed.boundedSourceFacts,[]);
 assert.deepEqual(r2.observed.artifactSha256,[]);
 assert.equal(r2.primaryEvidenceNeeded,'Effective permission grants');
 assert.match(r2.observed.description,/absence is not evidence/i);
 assert.deepEqual(p.authority,{planOnly:true,activeTestsExecuted:false,humanReviewRequired:true,
  findingsConfirmed:0,evidenceAccepted:false,securityStateChanged:false,deploymentDecisionWritten:false});
});
test('other controls, unbound and foreign digests never supply this requirement evidence',()=>{
 const d=makeDossier();
 // Reusing C under another control does not authorise its content here.
 d.controls[0].reviewRequirements[1].boundedSourceFacts.push(
  {collector:'foreign_control',artifactSha256:C,values:{dependencyCount:9999}});
 const p=buildControlVerificationPlan(d,'ARL-KB-021');
 assert.equal(p.requirements[1].observed.boundedSourceFacts.length,0);
 assert.equal(p.requirements[0].observed.boundedSourceFacts.length,1);
 const other=buildControlVerificationPlan(d,'ARL-KB-082');
 assert.equal(other.requirements[0].observed.boundedSourceFacts.length,1);
 assert.equal(other.requirements[0].observed.boundedSourceFacts[0].artifactSha256,C);
});
test('active execution is always blocked by this planner, including governance-only controls',()=>{
 const d=makeDossier();
 for(const p of buildAssessmentVerificationPlans(d).plans){
  for(const r of p.requirements){
   assert.equal(r.activeTest.executionAllowed,false);
   assert.equal(r.activeTest.state,'blocked_no_verified_rules_of_engagement');
   assert.equal(r.activeTest.prerequisites.length,3);
   assert.equal(r.conclusionGate.requiresHumanDecision,true);
   assert.equal(r.conclusionGate.result,'undetermined');
   assert.equal(r.conclusionGate.findingConfirmed,false);
   assert.equal(r.conclusionGate.remediationOrClosureAllowed,false);
  }
 }
 assert.equal(buildControlVerificationPlan(d,'ARL-KB-082').requirements[0].activeTest.proposedScenario,null);
});
test('different dossiers remain independent; absent and duplicate controls fail closed',()=>{
 const one=makeDossier();
 const two=makeDossier('prj_two','sys_two','e'.repeat(40));
 two.controls[0].reviewRequirements[0].artifactDigests=[B];
 two.controls[0].reviewRequirements[0].boundedSourceFacts=[{artifactSha256:B,
  collector:'architecture_and_inventory',values:{mcpAndToolReferenceFilesCount:2}}];
 const x=buildAssessmentVerificationPlans(one);
 const y=buildAssessmentVerificationPlans(two);
 assert.equal(x.plans.length,2);
 assert.equal(y.plans.length,2);
 assert.notEqual(x.projectId,y.projectId);
 assert.deepEqual(x.plans[0].requirements[0].observed.artifactSha256,[A]);
 assert.deepEqual(y.plans[0].requirements[0].observed.artifactSha256,[B]);
 assert.throws(()=>buildControlVerificationPlan(one,'ARL-KB-999'),/absent/);
 one.controls[1].controlId=one.controls[0].controlId;
 assert.throws(()=>buildAssessmentVerificationPlans(one),/non-authoritative dossier/);
});
test('cannot smuggle authority through a forged dossier or requirement',()=>{
 const mutations=[
  d=>{d.confirmedFindings=1;},
  d=>{d.deploymentDecisionWritten=true;},
  d=>{d.evidenceAccepted=true;},
  d=>{d.controls[0].confirmedFinding=true;},
  d=>{d.controls[0].reviewRequirements[0].proofStatus='accepted';},
  d=>{d.controls[0].reviewRequirements[0].requiresHumanDecision=false;},
  d=>{d.targetRevision='stale';}
 ];
 for(const mutate of mutations){
  const d=makeDossier();mutate(d);
  assert.throws(()=>buildControlVerificationPlan(d,'ARL-KB-021'),/non-authoritative dossier/);
 }
 const d=makeDossier();
 d.controls[0].reviewRequirements[1].requirementIndex=1;
 assert.throws(()=>buildControlVerificationPlan(d,'ARL-KB-021'),/Duplicate requirement/);
});

test('one capped requirement cannot contaminate another requirement verification plan',()=>{
 const d=makeDossier();
 d.controls[0].reviewRequirements[1].artifactDigests=[B];
 d.controls[0].reviewRequirements[1].boundedSourceFacts=[{
  collector:'source_and_configuration',artifactSha256:B,
  values:{discoveryCoverage:{completeTrackedAndTextScan:true}}
 }];
 const p=buildControlVerificationPlan(d,'ARL-KB-021');
 assert.equal(p.coverage.limitedCoverage,true);
 assert.equal(p.requirements[0].observed.boundedScanCoverageState,'limited_bounded_scan');
 assert.equal(p.requirements[1].observed.boundedScanCoverageState,'reported_complete_bounded_scan');
 assert.ok(p.requirements[0].unresolved.some(x=>/capped/.test(x)));
 assert.ok(!p.requirements[1].unresolved.some(x=>/capped/.test(x)));
});
test('method hints avoid substring matches and generic model or token assumptions',()=>{
 const cases=[
  ['Versioned MCP tool catalog','tool_and_protocol'],
  ['Effective permission grants','identity_and_permissions'],
  ['Bearer token revocation','identity_and_permissions'],
  ['Token budget exhaustion','source_and_configuration'],
  ['Model output accuracy evaluation','source_and_configuration'],
  ['Catalog of internal assets','source_and_configuration'],
  ['Audit log events','audit_and_monitoring'],
  ['Network egress allowlist','network_and_data_flow'],
  ['Supplier model artifact provenance','supplier_and_dependency'],
  ['Prompt memory boundary','instruction_and_context'],
  ['Risk owner approval record','governance_and_approval']
 ];
 for(const [requirement,expectedMethod] of cases){
  const d=makeDossier();
  d.controls[0].purpose='Review general requirements';
  d.controls[0].assessmentMethod='Compare source evidence';
  d.controls[0].reviewRequirements[0].expectedEvidence=requirement;
  const plan=buildControlVerificationPlan(d,'ARL-KB-021');
  assert.equal(plan.requirements[0].verification.type,expectedMethod,requirement);
 }
});
test('every control needs an affirmative human review gate',()=>{
 const d=makeDossier();
 delete d.controls[0].humanReviewRequired;
 assert.throws(()=>buildControlVerificationPlan(d,'ARL-KB-021'),/non-authoritative/);
});

test('human-decision workflow is not incorrectly treated as a ban on technical verification planning',()=>{
 const d=makeDossier();
 const control=d.controls[1];
 control.category='Tools, MCP and agent authority';
 control.title='Network egress constraints';
 control.assessmentMethod='Inspect egress policy and network destinations';
 control.reviewRequirements[0].expectedEvidence='Network egress policy and destination allowlist';
 const r=buildControlVerificationPlan(d,'ARL-KB-082').requirements[0];
 assert.equal(r.verification.type,'network_and_data_flow');
 assert.match(r.activeTest.proposedScenario,/staging-only denied-destination/);
 assert.equal(r.activeTest.state,'blocked_no_verified_rules_of_engagement');
 assert.equal(r.activeTest.executionAllowed,false);
 assert.equal(r.conclusionGate.requiresHumanDecision,true);
});

test('cross-cutting scope records do not imply tool execution tests',()=>{
 const d=makeDossier();
 d.controls[0].reviewRequirements[0].expectedEvidence=
   'ARL-KB-021 assessed system, version, environment and tool scope';
 const p=buildControlVerificationPlan(d,'ARL-KB-021');
 const r=p.requirements[0];
 assert.equal(r.verification.type,'assessment_scope_and_version');
 assert.match(r.verification.technical,/frozen target revision/);
 assert.equal(r.activeTest.proposedScenario,null);
 assert.equal(r.activeTest.executionAllowed,false);
 assert.equal(r.conclusionGate.requiresHumanDecision,true);
});
test('reviewer attestations are evidence provenance, never least-privilege test prompts',()=>{
 const d=makeDossier();
 d.controls[0].reviewRequirements[0].expectedEvidence=
  'ARL-KB-021 reviewer identity, role, timestamp and evidence digest';
 const r=buildControlVerificationPlan(d,'ARL-KB-021').requirements[0];
 assert.equal(r.verification.type,'reviewer_record_provenance');
 assert.match(r.verification.technical,/reconcile the cited evidence digest/);
 assert.equal(r.activeTest.proposedScenario,null);
 assert.equal(r.activeTest.executionAllowed,false);
 const permission=buildControlVerificationPlan(d,'ARL-KB-021').requirements[1];
 assert.equal(permission.verification.type,'identity_and_permissions');
 assert.notEqual(permission.activeTest.proposedScenario,null);
});

test('incident tabletop records require documentary review, not generic log or tool tests',()=>{
 const d=makeDossier();
 d.controls[0].purpose='Review incident response readiness';
 d.controls[0].assessmentMethod='Verify signed exercise evidence';
 const scenarios=['Incident response tabletop record and participants',
  'Signed incident exercise findings and corrective actions',
  'Dated incident simulation evidence and sign-off'];
 for(const wording of scenarios){
  d.controls[0].reviewRequirements[0].expectedEvidence=wording;
  const r=buildControlVerificationPlan(d,'ARL-KB-021').requirements[0];
  assert.equal(r.verification.type,'incident_exercise_record',wording);
  assert.match(r.verification.technical,/timeline|corrective actions/);
  assert.equal(r.activeTest.proposedScenario,null);
  assert.equal(r.activeTest.executionAllowed,false);
  assert.equal(r.conclusionGate.result,'undetermined');
  assert.equal(r.conclusionGate.requiresHumanDecision,true);
 }
 d.controls[0].reviewRequirements[0].expectedEvidence='Incident alert telemetry and event logs';
 const runtime=buildControlVerificationPlan(d,'ARL-KB-021').requirements[0];
 assert.equal(runtime.verification.type,'audit_and_monitoring');
 assert.match(runtime.activeTest.proposedScenario,/synthetic event/);
});
