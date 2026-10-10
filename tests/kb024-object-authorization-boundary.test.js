import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import crypto from 'node:crypto';
import { buildCanonicalEvidenceRequirementPlan } from '../src/agent/canonical-evidence-requirement-plan.mjs';
const asset = JSON.parse(fs.readFileSync(new URL('../risk-knowledge/risk-knowledge-v1.json', import.meta.url), 'utf8'));
const entry = asset.entries.find(x => x.id === 'ARL-KB-024');
const migration = fs.readFileSync(new URL('../migrations/047_risk_knowledge_kb024_object_authorization.sql', import.meta.url), 'utf8');
const canon = v => Array.isArray(v) ? '['+v.map(canon).join(',')+']' : v&&typeof v==='object' ? '{'+Object.keys(v).sort().map(k=>JSON.stringify(k)+':'+canon(v[k])).join(',')+'}' : JSON.stringify(v);
const digest = v => crypto.createHash('sha256').update(canon(v)).digest('hex');
test('KB024 canonical hashes match the additive migration and human authority remains intact', () => {
 assert.ok(entry);
 const {content_digest, ...rest} = entry;
 assert.equal(digest(rest), content_digest);
 assert.ok(migration.includes(content_digest));
 assert.ok(migration.includes(digest(entry.check)));
 assert.ok(migration.includes(digest(entry.solution)));
 assert.equal(entry.validation.status,'candidate');
 assert.equal(entry.review.human_review_required,true);
 assert.equal(entry.operational_metadata.customer_validation_status,'unvalidated');
});
test('KB024 seven evidence types distinguish static, active and human decisions', () => {
 const req=entry.check.required_evidence;
 assert.equal(req.length,7);
 const plan=buildCanonicalEvidenceRequirementPlan(req);
 assert.deepEqual(plan.map(x=>x.mode),['machine_collectable','human_only','machine_collectable','active_test_or_runtime','active_test_or_runtime','active_test_or_runtime','human_only']);
 assert.ok(plan[0].collectors.includes('target_identity'));
 assert.ok(plan[2].collectors.includes('source_and_configuration'));
 for(const i of [1,3,4,5,6])assert.deepEqual(plan[i].collectors,[]);
 assert.match(entry.check.negative_test,/cross-tenant/);
 assert.match(entry.check.pass_condition,/accountable human review/);
 assert.match(entry.check.fail_condition,/information disclosure/);
});
test('KB024 bootstrap includes 047 without replacing older migrations', () => {
 const db=fs.readFileSync(new URL('../src/db-adapters/sqlite-local.js', import.meta.url),'utf8');
 assert.match(db,/046_risk_knowledge_kb023_function_authorization\.sql/);
 assert.match(db,/047_risk_knowledge_kb024_object_authorization\.sql/);
});
