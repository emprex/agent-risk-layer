import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import crypto from 'node:crypto';
import { buildCanonicalEvidenceRequirementPlan } from '../src/agent/canonical-evidence-requirement-plan.mjs';
const asset = JSON.parse(fs.readFileSync(new URL('../risk-knowledge/risk-knowledge-v1.json', import.meta.url), 'utf8'));
const entry = asset.entries.find(item => item.id === 'ARL-KB-021');
const migration = fs.readFileSync(new URL('../migrations/044_risk_knowledge_kb021_session_assurance.sql', import.meta.url), 'utf8');
const canonical = x => Array.isArray(x) ? '['+x.map(canonical).join(',')+']' : x && typeof x === 'object' ? '{'+Object.keys(x).sort().map(k=>JSON.stringify(k)+':'+canonical(x[k])).join(',')+'}' : JSON.stringify(x);
const digest = x => crypto.createHash('sha256').update(canonical(x)).digest('hex');
test('KB021 canonical integrity matches additive migration', () => {
 const {content_digest,...unsigned} = entry;
 assert.equal(content_digest,digest(unsigned));
 for (const v of [content_digest,digest(entry.check),digest(entry.solution)]) assert.ok(migration.includes(v));
});
test('KB021 session evidence requires distinct technical, runtime, and human authority', () => {
 const evidence = entry.check.required_evidence;
 assert.equal(evidence.length,7);
 const plan = buildCanonicalEvidenceRequirementPlan(evidence);
 assert.deepEqual(plan.map(x=>x.mode),['machine_collectable','human_only','machine_collectable','active_test_or_runtime','active_test_or_runtime','active_test_or_runtime','human_only']);
 assert.ok(plan[0].collectors.includes('target_identity'));
 assert.ok(plan[2].collectors.includes('source_and_configuration'));
 for(const i of [1,3,4,5,6]) assert.deepEqual(plan[i].collectors,[]);
 assert.doesNotMatch(evidence.join(' '),/agent and model context/i);
 assert.equal(entry.validation.status,'candidate');
});
