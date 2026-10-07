import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

test('focused control projection keeps full test history so a closed exact-retest lineage can resolve its original failure', () => {
  const source = fs.readFileSync(
    new URL('../src/control-intelligence-core.js', import.meta.url),
    'utf8'
  );

  assert.match(
    source,
    /const derived = \{ tests, evidence, testHistory, evidenceHistory:lineageEvidence/
  );

  assert.doesNotMatch(
    source,
    /const derived = \{ tests, evidence, testHistory:lineageTests/
  );
});
