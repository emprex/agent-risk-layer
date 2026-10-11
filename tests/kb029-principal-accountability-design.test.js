import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {buildCanonicalEvidenceRequirementPlan} from '../src/agent/canonical-evidence-requirement-plan.mjs';

const asset=JSON.parse(fs.readFileSync(new URL('../risk-knowledge/risk-knowledge-v1.json',import.meta.url),'utf8'));
const control=asset.entries.find(x=>x.id==='ARL-KB-029');
const requirements=control.check.required_evidence;

test('KB-029 proposed evidence keeps source, synthetic runtime and human decisions separated',()=>{
 const plan=buildCanonicalEvidenceRequirementPlan(requirements);
 assert.deepEqual(plan.map(x=>x.mode),[
  'machine_collectable','human_only','machine_collectable',
  'active_test_or_runtime','active_test_or_runtime','active_test_or_runtime','human_only'
 ]);
 assert.ok(plan[0].collectors.includes('target_identity'));
 assert.ok(plan[2].collectors.includes('source_and_configuration'));
 for(const i of [1,3,4,5,6])assert.deepEqual(plan[i].collectors,[]);
});

test('KB-029 explicit fake-identity scenarios cannot authorize real credential tests or automatic PASS',()=>{
 const data=JSON.parse(fs.readFileSync(new URL('./fixtures/kb029-synthetic-principal-scenarios.json',import.meta.url),'utf8'));
 assert.equal(data.status,'design_only_not_executed');
 assert.equal(data.frozenTarget.sha,'b3116fcfcec3bf6967773c3e9587c502b1fed5e5');
 assert.match(data.frozenTarget.sha,/^[a-f0-9]{40}$/);
 assert.equal(data.guardrails.ownerWrittenRoERequired,true);
 assert.equal(data.guardrails.liveProviderCallsExecuted,false);
 assert.equal(data.guardrails.rawCredentialsPresent,false);
 assert.equal(data.guardrails.automaticFindingForbidden,true);
 assert.equal(data.scenarios.length,8);
 assert.equal(new Set(data.scenarios.map(x=>x.id)).size,8);
 for(const item of data.scenarios){
  assert.match(item.actor,/synthetic_/);
  assert.ok(item.expected.startsWith(item.type==='negative'?'deny':'allow'));
 }
 for(const id of ['generic-admin','swapped-delegation','self-approval','shared-approval-token','breakglass-unattributed']){
  assert.ok(data.scenarios.some(x=>x.id===id));
 }
});
