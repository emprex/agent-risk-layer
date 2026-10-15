import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {renderClientPreassessment} from '../src/agent/client-preassessment-export.mjs';

// This is an OFFLINE, synthetic quality contract driven by all canonical
// 108 knowledge controls. It does not invent verified real-world evidence.
test('canonical 108-control preassessment renders complete bounded and honest 575-requirement register',()=>{
 const kb=JSON.parse(fs.readFileSync(new URL('../risk-knowledge/risk-knowledge-v1.json',import.meta.url),'utf8'));
 assert.equal(kb.entries.length,108);
 const controls=kb.entries.map((entry,i)=>({
  controlId:entry.id,title:entry.title,category:entry.category,
  purpose:entry.check.objective,assessmentMethod:entry.check.method,
  workflowLane:i<5?'human_decision':'test_planning',
  result:'undetermined',confirmedFinding:false,humanReviewRequired:true,
  reviewRequirements:entry.check.required_evidence.map((text,j)=>({
   requirementIndex:j+1,expectedEvidence:text,artifactDigests:[],
   sourceProjectionRevisions:[],boundedSourceFacts:[],
   proofStatus:'not_validated',requiresHumanDecision:true,
   acceptanceCriterion:'Human reviewer verifies scoped primary evidence.'
  }))
 }));
 const count=controls.reduce((n,c)=>n+c.reviewRequirements.length,0);
 assert.equal(count,575);
 // Synthetic static candidate: a verified-shaped hash does NOT confer validity.
 const provider=controls.find(c=>c.controlId==='ARL-KB-007');
 const target=provider.reviewRequirements.find(r=>/observed model, MCP, plugin/i.test(r.expectedEvidence));
 assert.ok(target);
 const hash='a'.repeat(64);
 target.artifactDigests=[hash];
 target.sourceProjectionRevisions=['legacy_unversioned'];
 target.boundedSourceFacts=[{
  collector:'architecture_and_inventory',artifactSha256:hash,
  values:{mcpAndToolReferenceFilesCount:2,
   referenceSamples:[{kind:'mcp_tool',hash:'b'.repeat(24)}]}
 }];
 // Three synthetic requirements isolate documentary and technical plan routing
 // in the actual customer-visible HTML. They do not change canonical KB.
 controls[10].reviewRequirements[0].expectedEvidence='Signed risk exception approval with scope, owner and expiry';
 controls[11].reviewRequirements[0].expectedEvidence='Incident response tabletop record with participants and observations';
 controls[12].reviewRequirements[0].expectedEvidence='Effective IAM permissions and token revocation';
 const d={schema:'arl.agent.assessment-action-dossiers.v1',
  projectId:'prj_synthetic',snapshotId:'sys_synthetic',
  targetRevision:'c'.repeat(40),controlsTotal:108,requirementsTotal:575,
  candidateRequirementCount:1,requiresEvidenceOrReviewCount:574,
  confirmedFindings:0,remediationPlansIssued:0,controls,
  humanReviewRequired:true,passFailInferred:false,evidenceAccepted:false,
  deploymentDecisionWritten:false,securityStateChanged:false};
 const html=renderClientPreassessment(d);
 assert.equal((html.match(/class="control" id=/g)||[]).length,108);
 assert.equal((html.match(/<div class="req">/g)||[]).length,575);
 assert.match(html,/575 individual evidence requirements/);
 assert.match(html,/Historical source-collection format/);
 assert.match(html,/Reference privacy/);
 assert.match(html,/No confirmed security findings/);
 assert.match(html,/blocked_no_verified_rules_of_engagement/);
 assert.match(html,/No active test proposed for this documentary or governance requirement/);
 assert.match(html,/mcp_tool/);
 assert.match(html,/bbbbbbbbbbbbbbbbbbbbbbbb/);
 assert.doesNotMatch(html,/confirmed exploitation|automatically validated as secure/i);
 // Report copy must not quietly turn documentary evidence into an active
 // technical test merely because the record mentions a risky operation.
 function sectionFor(controlId){
  const start=html.indexOf('<article class="control" id="'+controlId+'">');
  assert.ok(start>=0,controlId);
  const end=html.indexOf('</article>',start);
  assert.ok(end>start,controlId);
  return html.slice(start,end);
 }
 function requirementFor(controlId,expectedEvidence){
  const section=sectionFor(controlId);
  const needle='<p><strong>Required:</strong> '+expectedEvidence+'</p>';
  const start=section.indexOf(needle);
  assert.ok(start>=0,controlId+' requirement missing');
  const end=section.indexOf('</div>',start);
  assert.ok(end>start,controlId+' requirement boundary missing');
  return section.slice(start,end);
 }
 const exception=requirementFor(controls[10].controlId,'Signed risk exception approval with scope, owner and expiry');
 const exercise=requirementFor(controls[11].controlId,'Incident response tabletop record with participants and observations');
 const permissions=requirementFor(controls[12].controlId,'Effective IAM permissions and token revocation');
 for(const documentary of [exception,exercise]){
  assert.match(documentary,/No active test proposed for this documentary or governance requirement/);
  assert.doesNotMatch(documentary,/A synthetic event with expected detection|A narrowly scoped, synthetic least-privilege/);
  assert.match(documentary,/not validated/);
 }
 assert.match(exception,/scope, accountable approver, rationale, expiry/);
 assert.match(exercise,/roles, timeline, scope, observed gaps/);
 assert.match(permissions,/narrowly scoped, synthetic least-privilege/);
 assert.match(permissions,/blocked_no_verified_rules_of_engagement/);
 // Every requirement still has a human conclusion gate.
 assert.equal((html.match(/<strong>Human conclusion gate:<\/strong>/g)||[]).length,575);
});
