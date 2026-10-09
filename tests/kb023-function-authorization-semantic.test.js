import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import crypto from 'node:crypto';
import { buildCanonicalEvidenceRequirementPlan } from '../src/agent/canonical-evidence-requirement-plan.mjs';
const asset = JSON.parse(fs.readFileSync(new URL('../risk-knowledge/risk-knowledge-v1.json', import.meta.url), 'utf8'));
const entry = asset.entries.find(item => item.id === 'ARL-KB-023');
const migration = fs.readFileSync(new URL('../migrations/046_risk_knowledge_kb023_function_authorization.sql', import.meta.url), 'utf8');
const canon = v => Array.isArray(v)?'['+v.map(canon).join(',')+']':v&&typeof v==='object'?'{'+Object.keys(v).sort().map(k=>JSON.stringify(k)+':'+canon(v[k])).join(',')+'}':JSON.stringify(v);
const digest = v => crypto.createHash('sha256').update(canon(v)).digest('hex');
test('KB023 signed content and migration have matching hashes', () => {
 const {content_digest,...rest} = entry;
 assert.equal(digest(rest),content_digest);
 assert.ok(migration.includes(content_digest));
 assert.ok(migration.includes(digest(entry.check)));
 assert.ok(migration.includes(digest(entry.solution)));
});
test('KB023 function-level authorization demands observed denials not UI claims', () => {
 const e = entry.check.required_evidence;
 assert.equal(e.length,7);
 const plan = buildCanonicalEvidenceRequirementPlan(e);
 assert.deepEqual(plan.map(x=>x.mode),['machine_collectable','human_only','machine_collectable','active_test_or_runtime','active_test_or_runtime','active_test_or_runtime','human_only']);
 assert.ok(plan[0].collectors.includes('target_identity'));
 assert.ok(plan[2].collectors.includes('source_and_configuration'));
 for(const i of [1,3,4,5,6])assert.deepEqual(plan[i].collectors,[]);
 assert.doesNotMatch(e.join(' '),/agent and model context/i);
 assert.equal(entry.validation.status,'candidate');
});
