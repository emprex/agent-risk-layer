import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import crypto from 'node:crypto';
import { buildCanonicalEvidenceRequirementPlan } from '../src/agent/canonical-evidence-requirement-plan.mjs';

// This test protects the existing signed KB-024 evidence boundaries. It does
// not certify authorization of any running customer system.
const asset = JSON.parse(fs.readFileSync(new URL('../risk-knowledge/risk-knowledge-v1.json', import.meta.url), 'utf8'));
const entry = asset.entries.find(item => item.id === 'ARL-KB-024');
const canonical = value => Array.isArray(value)
  ? '[' + value.map(canonical).join(',') + ']'
  : value && typeof value === 'object'
    ? '{' + Object.keys(value).sort().map(key => JSON.stringify(key) + ':' + canonical(value[key])).join(',') + '}'
    : JSON.stringify(value);
const digest = value => crypto.createHash('sha256').update(canonical(value)).digest('hex');

test('KB-024 signed canonical entry retains human-only deployment authority', () => {
  assert.ok(entry);
  const { content_digest, ...unsigned } = entry;
  assert.equal(content_digest, digest(unsigned));
  assert.equal(entry.validation.status, 'candidate');
  assert.equal(entry.review.human_review_required, true);
  assert.equal(entry.operational_metadata.customer_validation_status, 'unvalidated');
});

test('KB-024 current evidence routes static scope separately from observed negative tests', () => {
  const evidence = entry.check.required_evidence;
  assert.equal(evidence.length, 5);
  const plan = buildCanonicalEvidenceRequirementPlan(evidence);
  assert.deepEqual(plan.map(item => item.mode), [
    'machine_collectable', 'machine_collectable',
    'active_test_or_runtime', 'active_test_or_runtime', 'human_only'
  ]);
  assert.ok(plan[0].collectors.includes('target_identity'));
  assert.ok(plan[1].collectors.includes('source_and_configuration'));
  for (const index of [2,3,4]) assert.deepEqual(plan[index].collectors, []);
  assert.match(entry.check.negative_test, /another synthetic user's or workspace's object/);
  assert.match(entry.check.negative_test, /without exposing foreign object metadata/);
  assert.match(entry.check.fail_condition, /applied after a side effect/);
});
