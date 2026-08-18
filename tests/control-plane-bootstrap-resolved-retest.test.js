import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const source = fs.readFileSync(new URL('../public/control-plane-bootstrap.js', import.meta.url), 'utf8');

test('Findings route stays open when latest Inspector retest resolved a finding', () => {
  assert.match(source, /function\s+resolvedFindingCount/);
  assert.match(source, /hasResolvedRetest/);
  assert.match(source, /!observed\.activeFindings\.length\s*&&\s*!observed\.hasResolvedRetest/);
});

test('Findings route still sends declaration-only assessments to Evidence', () => {
  assert.match(source, /location\.replace\(`\/inspector\.html\?\$\{evidenceParams\.toString\(\)\}`\)/);
  assert.match(source, /actionableFindings\(assessment\)\.length\s*>\s*0/);
});
