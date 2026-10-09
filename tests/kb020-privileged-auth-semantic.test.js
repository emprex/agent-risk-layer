import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import crypto from 'node:crypto';
import { buildCanonicalEvidenceRequirementPlan } from '../src/agent/canonical-evidence-requirement-plan.mjs';
const asset = JSON.parse(fs.readFileSync(new URL('../risk-knowledge/risk-knowledge-v1.json', import.meta.url), 'utf8'));
const entry = asset.entries.find(item => item.id === 'ARL-KB-020');
const migration = fs.readFileSync(new URL('../migrations/042_risk_knowledge_kb020_privileged_mfa_correction.sql', import.meta.url), 'utf8');
function canonical(x) { if (Array.isArray(x)) return '[' + x.map(canonical).join(',') + ']'; if (x && typeof x === 'object') return '{' + Object.keys(x).sort().map(k => JSON.stringify(k) + ':' + canonical(x[k])).join(',') + '}'; return JSON.stringify(x); }
const digest = value => crypto.createHash('sha256').update(canonical(value)).digest('hex');
test('KB-020 knowledge digests and migration align', () => {
  const { content_digest, ...unsigned } = entry;
  assert.equal(content_digest, digest(unsigned));
  assert.ok(migration.includes(content_digest));
  assert.ok(migration.includes(digest(entry.check)));
  assert.ok(migration.includes(digest(entry.solution)));
});
test('KB-020 evidence requires the appropriate authority', () => {
  const requirements = entry.check.required_evidence;
  assert.equal(requirements.length, 7);
  const plan = buildCanonicalEvidenceRequirementPlan(requirements);
  assert.deepEqual(plan.map(item => item.mode), ['machine_collectable','human_only','human_only','machine_collectable','active_test_or_runtime','active_test_or_runtime','human_only']);
  assert.ok(plan[0].collectors.includes('target_identity'));
  assert.ok(plan[3].collectors.includes('source_and_configuration'));
  assert.equal(entry.review.human_review_required, true);
});
