import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const source = readFileSync(new URL('../src/agent/local-assessment-workflow.mjs', import.meta.url), 'utf8');

test('manual evidence result provides explicit recorded receipt and safe disposition instruction', () => {
  const section = source.split('  const manualEvidence =\n    parseLocalManualEvidenceCommand(request);')[1]
    .split("  if (/^i authorise the bounded test")[0];
  assert.match(section, /Manual control review RECORDED:/);
  assert.match(section, /Test execution: /);
  assert.match(section, /Document inconclusive review /);
  assert.match(section, /No deployment approval or finding closure is implied/);
  assert.match(section, /next\.answer/);
});

test('human evidence batch confirms successful recording and never equates inconclusive with PASS', () => {
  const section = source.split('  const humanEvidenceBatch =')[1]
    .split('  const manualEvidence =\n    parseLocalManualEvidenceCommand(request);')[0];
  assert.match(section, /Human evidence batch RECORDED:/);
  assert.match(section, /Inconclusive reviews recorded:/);
  assert.match(section, /Document inconclusive review /);
  assert.match(section, /No PASS, finding closure or deployment approval is implied/);
});
