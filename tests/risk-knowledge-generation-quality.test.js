import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { assertRiskKnowledgeQuality, auditRiskKnowledge, canonicalJson, digestRecord } from '../scripts/risk-knowledge-quality.mjs';

const root = path.resolve(import.meta.dirname, '..');
const generatedFiles = [
  'risk-knowledge/risk-knowledge-v1.json',
  'risk-knowledge/risk-knowledge-v1.csv',
  'public/risk-knowledge-public-v1.1.json',
  'migrations/014_seed_risk_knowledge_v1_2.sql',
  'docs/RISK_KNOWLEDGE_SEMANTIC_QUALITY.md',
];
const read = (name) => fs.readFileSync(path.join(root, name), 'utf8');
const asset = JSON.parse(read(generatedFiles[0]));

function parseCsv(text) {
  const rows = [];
  let row = [], value = '', quoted = false;
  for (let index = 0; index < text.length; index += 1) {
    const character = text[index];
    if (quoted && character === '"' && text[index + 1] === '"') { value += '"'; index += 1; }
    else if (character === '"') quoted = !quoted;
    else if (!quoted && character === ',') { row.push(value); value = ''; }
    else if (!quoted && character === '\n') { row.push(value); rows.push(row); row = []; value = ''; }
    else value += character;
  }
  return rows.filter((item) => item.some(Boolean));
}

function hashes() {
  return Object.fromEntries(generatedFiles.map((name) => [name, crypto.createHash('sha256').update(read(name)).digest('hex')]));
}

test('all generated control sentences pass semantic quality rules', () => {
  const report = assertRiskKnowledgeQuality(asset);
  assert.equal(report.controlsInspected, 108);
  assert.equal(report.malformedRecords, 0);
  assert.equal(report.unresolvedPlaceholders, 0);
  assert.equal(report.digestMismatches, 0);
  assert.deepEqual(report.duplicateFieldBlocks, { passCondition: 0, failCondition: 0, requiredEvidence: 0, retestAcceptance: 0 });
  assert.equal(auditRiskKnowledge(asset).findings.length, 0);
});

test('known truncation, orphan and placeholder defects are rejected', () => {
  const bad = structuredClone(asset);
  bad.entries = [structuredClone(asset.entries[47])];
  bad.entries[0].check.positive_test = 'orphaned lowercase fragment.';
  bad.entries[0].check.negative_test = 'Attempt the ${CONTROL_ID} abuse and record e.';
  bad.entries[0].solution.retest_acceptance[1] = 'ARL-KB-048: the valid With the documented control enabled remains available.';
  bad.entries[0].solution.retest_acceptance[2] = 'ARL-KB-048: the Attempt abuse record e is denied.';
  bad.entries[0].content_digest = digestRecord(bad.entries[0]);
  const report = auditRiskKnowledge(bad);
  assert.ok(report.findings.some((finding) => finding.issue === 'incomplete_sentence'));
  assert.ok(report.findings.some((finding) => finding.issue === 'truncated_mid_word'));
  assert.ok(report.findings.some((finding) => finding.issue === 'orphaned_lowercase_fragment'));
  assert.ok(report.findings.some((finding) => finding.issue === 'known_malformed_combination'));
  assert.ok(report.findings.some((finding) => finding.issue === 'unresolved_placeholder'));
  assert.ok(report.findings.some((finding) => finding.issue === 'missing_expected_result'));
});

test('public JSON, CSV and migration seed agree with canonical records and digests', () => {
  const publicAsset = JSON.parse(read(generatedFiles[2]));
  const publicById = new Map(publicAsset.entries.map((entry) => [entry.id, entry]));
  const csvRows = parseCsv(read(generatedFiles[1]));
  const headers = csvRows.shift();
  const csvById = new Map(csvRows.map((row) => [row[0], Object.fromEntries(headers.map((header, index) => [header, row[index]]))]));
  const migration = read(generatedFiles[3]);
  for (const entry of asset.entries) {
    assert.equal(entry.content_digest, digestRecord(entry), entry.id);
    const publicEntry = publicById.get(entry.id);
    assert.equal(publicEntry.content_digest, entry.content_digest, entry.id);
    assert.equal(publicEntry.problem.statement, entry.problem.statement, entry.id);
    assert.equal(publicEntry.validation.status, 'candidate', entry.id);
    const csvEntry = csvById.get(entry.id);
    assert.equal(csvEntry.content_digest, entry.content_digest, entry.id);
    assert.equal(csvEntry.pass_condition, entry.check.pass_condition, entry.id);
    assert.equal(csvEntry.fail_condition, entry.check.fail_condition, entry.id);
    assert.equal(csvEntry.retest_acceptance, entry.solution.retest_acceptance.join('|'), entry.id);
    assert.match(migration, new RegExp(`content_digest='${entry.content_digest}'.*WHERE id='${entry.id}'`), entry.id);
    assert.ok(migration.includes(`retest_acceptance_json='${JSON.stringify(entry.solution.retest_acceptance).replaceAll("'", "''")}'`), entry.id);
  }
  assert.equal(canonicalJson(JSON.parse(JSON.stringify(asset))), canonicalJson(asset));
});

test('generation is deterministic and byte-identical on a second run', () => {
  const run = () => spawnSync(process.execPath, ['scripts/build-risk-knowledge-v1-2.mjs'], { cwd: root, encoding: 'utf8' });
  const first = run();
  assert.equal(first.status, 0, first.stderr);
  const firstHashes = hashes();
  const second = run();
  assert.equal(second.status, 0, second.stderr);
  assert.deepEqual(hashes(), firstHashes);
});
