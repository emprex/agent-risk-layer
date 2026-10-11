import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { buildCanonicalEvidenceRequirementPlan } from '../src/agent/canonical-evidence-requirement-plan.mjs';

const plan = [
  'ARL-KB-026 assessed system, exact version, environment and service-hop scope',
  'ARL-KB-026 organisation-approved workload identity, audience and operation matrix',
  'ARL-KB-026 source or configuration evidence for receiver-side workload authentication and audience restrictions',
  'ARL-KB-026 positive and abuse inputs with expected and observed outputs for permitted synthetic service identities',
  'ARL-KB-026 bounded negative evidence for missing, wrong-audience, retired, replayed or confused-deputy service identities',
  'ARL-KB-026 observed runtime correlation of subject, audience, policy, decision, authorization and downstream effects',
  'ARL-KB-026 reviewer identity, role, timestamp and evidence digest'
];

test('KB-026 proposed seven-clause plan keeps machine, runtime and human evidence separate', () => {
  const classified = buildCanonicalEvidenceRequirementPlan(plan);
  assert.equal(classified.length,7);
  assert.deepEqual(classified.map(x => x.mode), [
    'machine_collectable','human_only','machine_collectable',
    'active_test_or_runtime','active_test_or_runtime','active_test_or_runtime','human_only'
  ]);
  assert.ok(classified[0].collectors.includes('target_identity'));
  assert.ok(classified[2].collectors.includes('source_and_configuration'));
  assert.equal(classified[4].collectors.length,0);
});

test('KB-026 synthetic pilot scenarios are explicit test designs without execution or PASS authority', () => {
  const file = new URL('./fixtures/kb026-synthetic-service-identity-scenarios.json',import.meta.url);
  const scenarios = JSON.parse(fs.readFileSync(file,'utf8'));
  assert.equal(scenarios.status,'design_only_not_executed');
  assert.equal(scenarios.guardrails.ownerAuthorizedRoeRequired,true);
  assert.equal(scenarios.guardrails.activeNetworkTestsExecuted,false);
  assert.equal(scenarios.guardrails.automaticPassAllowed,false);
  assert.equal(scenarios.target.frozenSha,'b3116fcfcec3bf6967773c3e9587c502b1fed5e5');
  assert.equal(scenarios.scenarios.length,7);
  assert.deepEqual(new Set(scenarios.scenarios.map(x=>x.id)).size,7);
  assert.ok(scenarios.scenarios.some(x=>x.id==='svc-wrong-audience'));
  assert.ok(scenarios.scenarios.some(x=>x.id==='svc-confused-deputy'));
  assert.ok(scenarios.scenarios.some(x=>x.id==='svc-async-context'));
  for (const item of scenarios.scenarios) {
    assert.match(item.actor,/synthetic|anonymous/i);
    assert.match(item.destination,/synthetic/i);
    assert.ok(typeof item.expected==='string'&&item.expected.includes(item.class==='negative'?'deny':'allow'));
  }
});
