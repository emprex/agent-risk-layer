import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import crypto from 'node:crypto';

import { digestRecord, canonicalJson } from '../scripts/risk-knowledge-quality.mjs';
import { buildCanonicalEvidenceRequirementPlan } from '../src/agent/canonical-evidence-requirement-plan.mjs';

const canonical = JSON.parse(fs.readFileSync(
  new URL('../risk-knowledge/risk-knowledge-v1.json', import.meta.url), 'utf8'
));
const kb = canonical.entries.find(entry => entry.id === 'ARL-KB-014');
const migration = fs.readFileSync(
  new URL('../migrations/061_kb014_runtime_evidence_route.sql', import.meta.url), 'utf8'
);
const sha256 = value => crypto.createHash('sha256').update(canonicalJson(value)).digest('hex');

test('KB-014 signed evidence route requires a scoped positive and negative runtime observation', () => {
  assert.ok(kb);
  assert.equal(kb.check.required_evidence.length, 6);
  const route = buildCanonicalEvidenceRequirementPlan(kb.check.required_evidence);
  assert.deepEqual(route.map(row => row.mode), [
    'machine_collectable', 'human_only', 'machine_collectable',
    'human_only', 'active_test_or_runtime', 'human_only'
  ]);
  assert.match(kb.check.required_evidence[4], /synthetic approved, revoked and orphan/);
  assert.equal(digestRecord(kb), kb.content_digest);
  assert.equal(kb.content_digest, '59ae778a119d0eb19b3ca2110b163e0f5b320b07518c98cb75a4a646bc5d2f5e');
  assert.equal(sha256(kb.check), '765bf3fd5de0036a7f00f04dae59c42a517dd6d0b619f01424198c9fdf4083f8');
});

test('KB-014 migration is digest-guarded and never changes historical security state', () => {
  const escape = value => String(value).replaceAll("'", "''");
  assert.ok(migration.includes("WHERE id='ARL-KB-014' AND content_digest='37d4568c5b8066eb244d3981ef94793544b0ecf18fbb8c24549054de4481b8aa'"));
  assert.ok(migration.includes("WHERE entry_id='ARL-KB-014' AND content_digest='9f55fdb91cf5d4543569eed6a3f920b11804153c3440685a6fbf51eac45bf361'"));
  assert.ok(migration.includes("required_evidence_json='" +
    escape(JSON.stringify(kb.check.required_evidence)) + "'"));
  assert.ok(migration.includes("content_digest='" + kb.content_digest + "'"));
  assert.match(migration, /UPDATE risk_knowledge_checks\s+SET/);
  assert.doesNotMatch(migration,
    /\b(?:DELETE FROM|DROP TABLE|TRUNCATE TABLE|UPDATE (?:control_test_executions|control_evidence_items|control_deployment_decisions|deployment_decision_evidence|assessment_master_dossier_revisions))\b/i
  );
});
