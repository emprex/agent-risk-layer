import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import crypto from 'node:crypto';
import { buildCanonicalEvidenceRequirementPlan } from '../src/agent/canonical-evidence-requirement-plan.mjs';
const asset = JSON.parse(fs.readFileSync(new URL('../risk-knowledge/risk-knowledge-v1.json', import.meta.url),'utf8'));
const entry = asset.entries.find(e => e.id === 'ARL-KB-025');
const migration = fs.readFileSync(new URL('../migrations/048_risk_knowledge_kb025_tenant_isolation.sql',import.meta.url),'utf8');
const canonical = value => Array.isArray(value) ? '[' + value.map(canonical).join(',') + ']'
 : value && typeof value === 'object' ? '{' + Object.keys(value).sort().map(k => JSON.stringify(k)+':'+canonical(value[k])).join(',') + '}'
 : JSON.stringify(value);
const digest = value => crypto.createHash('sha256').update(canonical(value)).digest('hex');
test('KB025 signed canonical and migration digests match while customer validation stays pending',() => {
 assert.ok(entry);
 const { content_digest,...unsigned } = entry;
 assert.equal(content_digest,digest(unsigned));
 assert.ok(migration.includes(content_digest));
 assert.ok(migration.includes(digest(entry.check)));
 assert.ok(migration.includes(digest(entry.solution)));
 assert.equal(entry.validation.status,'candidate');
 assert.equal(entry.review.human_review_required,true);
 assert.equal(entry.operational_metadata.customer_validation_status,'unvalidated');
});
test('KB025 seven evidence families prevent static-only tenant isolation conclusions',() => {
 const requirements=entry.check.required_evidence;
 assert.equal(requirements.length,7);
 const plan=buildCanonicalEvidenceRequirementPlan(requirements);
 assert.deepEqual(plan.map(x=>x.mode),['machine_collectable','human_only','machine_collectable','active_test_or_runtime','active_test_or_runtime','active_test_or_runtime','human_only']);
 assert.ok(plan[0].collectors.includes('target_identity'));
 assert.ok(plan[2].collectors.includes('source_and_configuration'));
 for(const i of [1,3,4,5,6]) assert.deepEqual(plan[i].collectors,[]);
 assert.match(requirements[4],/cross-tenant/);
 assert.match(entry.check.objective,/vector retrieval, memory, caches, asynchronous jobs, tools, exports and logs/);
 assert.match(entry.check.pass_condition,/accountable human review/);
 assert.match(entry.check.fail_condition,/confirmed FAIL/);
 assert.match(entry.check.fail_condition,/INCONCLUSIVE \/ EVIDENCE GAP \/ REVIEW REQUIRED/);
 assert.match(entry.check.fail_condition,/block PASS and deployment/);
 assert.doesNotMatch(entry.check.fail_condition,/fails or requires review/i);
});
test('KB025 additive migration registered without dropping KB024',() => {
 const db=fs.readFileSync(new URL('../src/db-adapters/sqlite-local.js',import.meta.url),'utf8');
 assert.match(db,/047_risk_knowledge_kb024_object_authorization\.sql/);
 assert.match(db,/048_risk_knowledge_kb025_tenant_isolation\.sql/);
});
