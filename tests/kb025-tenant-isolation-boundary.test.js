import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import crypto from 'node:crypto';
import { buildCanonicalEvidenceRequirementPlan } from '../src/agent/canonical-evidence-requirement-plan.mjs';

const asset = JSON.parse(fs.readFileSync(new URL('../risk-knowledge/risk-knowledge-v1.json', import.meta.url),'utf8'));
const entry = asset.entries.find(e => e.id === 'ARL-KB-025');
const canonical = value => Array.isArray(value) ? '[' + value.map(canonical).join(',') + ']'
 : value && typeof value === 'object' ? '{' + Object.keys(value).sort().map(k => JSON.stringify(k)+':'+canonical(value[k])).join(',') + '}'
 : JSON.stringify(value);
const digest = value => crypto.createHash('sha256').update(canonical(value)).digest('hex');

test('KB-025 current signed entry is unvalidated and human-controlled', () => {
 assert.ok(entry);
 const { content_digest, ...unsigned } = entry;
 assert.equal(content_digest, digest(unsigned));
 assert.equal(entry.validation.status, 'candidate');
 assert.equal(entry.review.human_review_required, true);
 assert.equal(entry.operational_metadata.customer_validation_status, 'unvalidated');
});
test('KB-025 existing five-clause evidence plan never replaces runtime denial with source inspection', () => {
 const evidence = entry.check.required_evidence;
 assert.equal(evidence.length, 5);
 const plan = buildCanonicalEvidenceRequirementPlan(evidence);
 assert.deepEqual(plan.map(x=>x.mode), [
  'machine_collectable','machine_collectable','active_test_or_runtime','active_test_or_runtime','human_only'
 ]);
 assert.ok(plan[0].collectors.includes('target_identity'));
 assert.ok(plan[1].collectors.includes('source_and_configuration'));
 for(const i of [2,3,4]) assert.deepEqual(plan[i].collectors, []);
 assert.match(entry.check.objective,/retrieval, memory, caches, background jobs, tools, exports and logs/i);
 assert.match(entry.check.fail_condition,/unsupported by reproducible evidence/i);
});
