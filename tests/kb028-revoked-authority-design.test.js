import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {buildCanonicalEvidenceRequirementPlan} from '../src/agent/canonical-evidence-requirement-plan.mjs';

const REQUIREMENTS = [
  'ARL-KB-028 assessed system, exact version, environment and identity/revocation scope',
  'ARL-KB-028 organisation-approved revocation policy, latency and accountable owner',
  'ARL-KB-028 source or configuration evidence for session invalidation, role cache, queued jobs and approval enforcement',
  'ARL-KB-028 bounded positive evidence of valid synthetic post-change low-privilege use',
  'ARL-KB-028 bounded negative evidence of removed workspace users, retired sessions, revoked keys, stale approvals and queued jobs after the documented cutoff',
  'ARL-KB-028 observed runtime correlation of revocation event, effective time, authorization at receiver and downstream effects',
  'ARL-KB-028 reviewer identity, role, timestamp, authorized scope and evidence digest'
];

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
