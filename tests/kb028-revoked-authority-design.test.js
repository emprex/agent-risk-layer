import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {buildCanonicalEvidenceRequirementPlan} from '../src/agent/canonical-evidence-requirement-plan.mjs';

const asset=JSON.parse(fs.readFileSync(new URL('../risk-knowledge/risk-knowledge-v1.json',import.meta.url),'utf8'));
const control=asset.entries.find(x=>x.id==='ARL-KB-028');
const REQUIREMENTS=control.check.required_evidence;

test('KB-028 separates exact scope, human policy, static evidence, runtime tests and review',()=>{
 const classified=buildCanonicalEvidenceRequirementPlan(REQUIREMENTS);
 assert.equal(classified.length,7);
 assert.deepEqual(classified.map(x=>x.mode),[
  'machine_collectable','human_only','machine_collectable',
  'active_test_or_runtime','active_test_or_runtime','active_test_or_runtime','human_only'
 ]);
 assert.ok(classified[0].collectors.includes('target_identity'));
 assert.ok(classified[2].collectors.includes('source_and_configuration'));
 for(const i of [1,3,4,5,6]) assert.equal(classified[i].collectors.length,0);
});

test('KB-028 synthetic design never asserts runtime outcome or changes frozen agent',()=>{
 const file=new URL('./fixtures/kb028-synthetic-revocation-scenarios.json',import.meta.url);
 const v=JSON.parse(fs.readFileSync(file,'utf8'));
 assert.equal(v.status,'design_only_not_executed');
 assert.match(v.frozenTarget.sha,/^[a-f0-9]{40}$/);
 assert.equal(v.frozenTarget.sha,'b3116fcfcec3bf6967773c3e9587c502b1fed5e5');
 assert.equal(v.guardrails.ownerWrittenRoERequired,true);
 assert.equal(v.guardrails.syntheticStagingIdentitiesOnly,true);
 assert.equal(v.guardrails.externalOrProductionTestsExecuted,false);
 assert.equal(v.guardrails.credentialsIncluded,false);
 assert.equal(v.guardrails.automaticPassAllowed,false);
 assert.equal(v.policy.maxPermittedRevocationLatency,'owner_documented_not_assumed');
 assert.equal(v.scenarios.length,9);
 for(const x of v.scenarios){
  assert.match(x.context,/synthetic/i);
  assert.ok(x.expected.startsWith(x.type==='negative'?'deny':'allow'));
 }
 for(const id of ['role-demoted','session-replayed','approval-withdrawn','queued-job-stale-role','retry-after-revocation']){
  assert.ok(v.scenarios.some(x=>x.id===id));
 }
});
