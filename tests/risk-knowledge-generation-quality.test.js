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
  'risk-knowledge/risk-knowledge-v1.sql',
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

test('builder preserves canonical control semantics', () => {
  const before = JSON.parse(read(generatedFiles[0]));

  const semanticProjection = (source) => ({
    schema: source.schema,
    asset: source.asset,
    entries: source.entries.map((entry) => {
      const clone = structuredClone(entry);
      delete clone.content_digest;
      return clone;
    }),
  });

  const beforeSemantics = semanticProjection(before);

  const run = spawnSync(
    process.execPath,
    ['scripts/build-risk-knowledge-v1-2.mjs'],
    { cwd: root, encoding: 'utf8' }
  );

  assert.equal(run.status, 0, run.stderr);

  const after = JSON.parse(read(generatedFiles[0]));
  const afterSemantics = semanticProjection(after);

  assert.deepEqual(
    afterSemantics,
    beforeSemantics,
    'risk-knowledge builder must not rewrite canonical control semantics'
  );
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
});

test('public JSON, CSV and generated SQL seed agree with canonical records and digests', () => {
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


test('KB-001 governance review uses governance evidence rather than generic runtime abuse vectors', () => {
  const kb001 = asset.entries.find((entry) => entry.id === 'ARL-KB-001');
  assert.ok(kb001);
  assert.match(kb001.check.method, /declared purpose/i);
  assert.match(kb001.check.method, /recent change history/i);
  assert.equal(
    (kb001.check.method.match(/Review the exact assessed version against the approved governance record/g) || []).length,
    1
  );
  assert.match(kb001.check.negative_test, /prompt, tool, integration, data source or capability/i);
  assert.match(kb001.check.negative_test, /explicit accountable approval/i);
  assert.match(kb001.check.pass_condition, /bounded, versioned and accountable purpose/i);
  assert.match(kb001.check.required_evidence.join(' '), /versioned business purpose/i);
  assert.match(kb001.check.required_evidence.join(' '), /change history and approvals/i);
  assert.doesNotMatch(kb001.check.negative_test, /malformed|replayed|unauthorised identity/i);
  assert.doesNotMatch(kb001.solution.retest_requirements, /malformed-input|replay/i);
});

test('KB-002 governance review verifies accountable risk-owner authority rather than agent-purpose scope', () => {
  const kb002 = asset.entries.find((entry) => entry.id === 'ARL-KB-002');
  assert.ok(kb002);

  assert.match(kb002.check.method, /named accountable risk owner/i);
  assert.match(kb002.check.method, /accept residual risk/i);
  assert.match(kb002.check.method, /stop or withhold deployment/i);

  assert.match(kb002.check.positive_test, /named person/i);
  assert.match(kb002.check.positive_test, /fund or authorise remediation/i);

  assert.match(kb002.check.negative_test, /missing, expired, names no individual/i);

  assert.match(kb002.check.required_evidence.join(' '), /named accountable risk owner/i);
  assert.match(kb002.check.required_evidence.join(' '), /residual-risk acceptance/i);
  assert.match(kb002.check.required_evidence.join(' '), /deployment stop or withholding/i);

  assert.match(kb002.check.pass_condition, /named accountable risk owner/i);
  assert.doesNotMatch(kb002.check.pass_condition, /bounded, versioned and accountable purpose/i);

  assert.match(kb002.solution.retest_requirements, /named accountable risk owner/i);
  assert.doesNotMatch(kb002.solution.retest_requirements, /bounded purpose|malformed-input|replay/i);

  assert.match(kb002.solution.retest_acceptance.join(' '), /named accountable risk owner/i);
  assert.match(kb002.solution.retest_acceptance.join(' '), /missing, expired, unnamed or incomplete ownership evidence/i);
  assert.doesNotMatch(kb002.solution.retest_acceptance.join(' '), /malformed-input|replay|boundary-crossing/i);
});

test('KB-003 governance review verifies prohibited-use and harm boundaries rather than agent-purpose scope', () => {
  const kb003 = asset.entries.find((entry) => entry.id === 'ARL-KB-003');
  assert.ok(kb003);

  assert.match(kb003.check.method, /prohibited-use and harm boundaries/i);
  assert.match(kb003.check.method, /representative forbidden requests/i);

  assert.match(kb003.check.positive_test, /authorised in-scope request/i);
  assert.match(kb003.check.negative_test, /representative forbidden request/i);
  assert.match(kb003.check.negative_test, /before any material side effect/i);

  assert.match(kb003.check.required_evidence.join(' '), /prohibited-use and harm-boundary policy/i);
  assert.match(kb003.check.required_evidence.join(' '), /forbidden request/i);

  assert.match(kb003.check.pass_condition, /explicit, versioned prohibited-use and harm boundaries/i);
  assert.doesNotMatch(kb003.check.pass_condition, /bounded, versioned and accountable purpose/i);

  assert.match(kb003.solution.retest_requirements, /prohibited-use and harm-boundary policy/i);
  assert.doesNotMatch(kb003.solution.retest_requirements, /bounded purpose|malformed-input|replay/i);

  assert.match(kb003.solution.retest_acceptance.join(' '), /prohibited users, decisions, sectors or actions are denied before/i);
});

test('KB-004 governance review compares declared risk classification with actual credible impact rather than agent-purpose scope', () => {
  const kb004 = asset.entries.find((entry) => entry.id === 'ARL-KB-004');

  assert.ok(kb004);

  assert.match(
    kb004.check.objective,
    /declared risk classification.*maximum credible impact/i
  );

  assert.match(
    kb004.check.method,
    /reachable assets.*maximum action values.*reversibility.*affected people.*scale.*dependency chains/i
  );

  assert.match(
    kb004.check.method,
    /compare that impact with the declared risk tier/i
  );

  assert.match(
    kb004.check.method,
    /accountable human reviewer/i
  );

  assert.match(
    kb004.check.required_evidence.join(' '),
    /maximum credible observed impact/i
  );

  assert.match(
    kb004.check.required_evidence.join(' '),
    /classification rationale/i
  );

  assert.match(
    kb004.check.pass_condition,
    /declared risk tier.*maximum credible observed impact/i
  );

  assert.match(
    kb004.check.fail_condition,
    /understates the maximum credible impact/i
  );

  assert.match(
    kb004.check.negative_test,
    /materially greater credible impact/i
  );

  assert.match(
    kb004.solution.retest_requirements,
    /maximum credible observed impact/i
  );

  assert.match(
    kb004.solution.retest_requirements,
    /accountable human reviewer/i
  );

  const combined = [
    kb004.check.objective,
    kb004.check.pass_condition,
    kb004.check.required_evidence.join(' '),
    kb004.solution.retest_requirements,
  ].join(' ');

  assert.doesNotMatch(
    combined,
    /bounded purpose|versioned business purpose|scope-expanding changes/i
  );
});
