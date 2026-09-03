import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
const read = (name) => fs.readFileSync(path.join(root, name), 'utf8');

test('simulation uploads use a non-target evidence class and explicit boundary', () => {
  const source = read('src/redteam.js');
  assert.match(source, /SIMULATION_EVIDENCE_CLASS = 'pipeline-simulation'/);
  assert.match(source, /SIMULATION_TRUST_BOUNDARY = 'Synthetic pipeline simulation used to verify runner, signing, and upload handling\. This is not evidence about the assessed target\.'/);
  assert.match(source, /evidenceClass: simulation \? SIMULATION_EVIDENCE_CLASS : ADAPTER_EVIDENCE_CLASS/);
  assert.match(source, /targetEvidence: !simulation/);
});

test('stored simulation runs are normalized on read so historical trust metadata cannot masquerade as target evidence', () => {
  const source = read('src/redteam.js');
  assert.match(source, /function normaliseStoredTrust\(campaign, trust\)/);
  assert.match(source, /campaign\?\.target\?\.mode !== 'simulation'/);
  assert.match(source, /evidenceClass: SIMULATION_EVIDENCE_CLASS/);
  assert.match(source, /targetEvidence: false/);
  assert.match(source, /const trust = normaliseStoredTrust\(campaign, parse\(row\.trust_json, \{\}\)\)/);
});

test('simulation run UI does not present target assurance or deployment decision', () => {
  const detail = read('public/redteam-run.js');
  const history = read('public/redteam.js');
  assert.match(detail, /SIMULATION — NOT TARGET EVIDENCE/);
  assert.match(detail, /No target assurance is produced by this run/);
  assert.match(detail, /Evidence class:/);
  assert.match(history, /Pipeline simulation \$\{complete\?'passed':'needs review'\}/);
  assert.match(history, /not target evidence/);
  assert.match(history, /View simulation/);
});

test('authorised adapter evidence keeps the controlled adversarial evidence class', () => {
  const source = read('src/redteam.js');
  assert.match(source, /ADAPTER_EVIDENCE_CLASS = 'customer-operated-controlled-adversarial-test'/);
  assert.match(source, /ADAPTER_TRUST_BOUNDARY = 'Integrity-verified redacted outcomes from a customer-operated local\/test\/staging run/);
});
