import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {buildCanonicalEvidenceRequirementPlan} from '../src/agent/canonical-evidence-requirement-plan.mjs';

const signed=JSON.parse(fs.readFileSync(new URL('../risk-knowledge/risk-knowledge-v1.json',import.meta.url),'utf8'));
const control=signed.entries.find(x=>x.id==='ARL-KB-027');
const requirements=control?.check?.required_evidence || [];

test('KB-027 design distinguishes static, active and accountable human requirements',()=>{
 const classified=buildCanonicalEvidenceRequirementPlan(requirements);
 assert.equal(classified.length,7);
 assert.deepEqual(classified.map(x=>x.mode),[
   'machine_collectable','human_only','machine_collectable',
   'active_test_or_runtime','active_test_or_runtime','active_test_or_runtime','human_only'
 ]);
 assert.ok(classified[0].collectors.includes('target_identity'));
 assert.ok(classified[2].collectors.includes('source_and_configuration'));
 for(const i of [1,3,4,5,6])assert.deepEqual(classified[i].collectors,[]);
});

test('KB-027 fixture cannot execute tests or hold actual credential values',()=>{
 const fixture=JSON.parse(fs.readFileSync(new URL('./fixtures/kb027-synthetic-api-key-scenarios.json',import.meta.url),'utf8'));
 assert.equal(fixture.status,'design_only_not_executed');
 assert.equal(fixture.target.frozenSha,'b3116fcfcec3bf6967773c3e9587c502b1fed5e5');
 assert.deepEqual(Object.values(fixture.guardrails),[true,true,false,false,false]);
 assert.equal(fixture.scenarios.length,7);
 assert.equal(new Set(fixture.scenarios.map(x=>x.id)).size,7);
 assert.equal(fixture.scenarios.filter(x=>x.class==='positive').length,1);
 assert.equal(fixture.scenarios.filter(x=>x.class==='negative').length,6);
 for(const row of fixture.scenarios){
  assert.match(row.credential,/^synthetic_/);
  assert.match(row.context,/synthetic/);
  assert.match(row.expected,row.class==='negative'?/\bdeny\b/:/\ballow\b/);
  assert.equal('token' in row,false);
  assert.equal('secret' in row,false);
 }
 const text=JSON.stringify(fixture);
 assert.doesNotMatch(text,/sk-proj-|sk-ant-|ghp_[A-Za-z0-9]+|Bearer\s+[A-Za-z0-9]/);
});
