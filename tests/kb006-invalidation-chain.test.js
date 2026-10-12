import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

test('invalidated historical KB-006 failure remains in history but cannot force active remediation', () => {
  const core = fs.readFileSync(new URL('../src/control-intelligence-core.js', import.meta.url), 'utf8');
  const projection = fs.readFileSync(new URL('../src/control-intelligence.js', import.meta.url), 'utf8');
  assert.match(core, /const invalidatedFindingIds = new Set\(findings/);
  assert.match(core, /row\.status === 'invalidated_unsubstantiated'/);
  assert.match(core, /!invalidatedFindingIds\.has\(row\.finding_id\)/);
  assert.match(core, /const historicalTests = \(data\.testHistory \|\| data\.tests\)/);
  assert.match(projection, /CLOSED_FINDING_STATES = new Set\(\['verified_closed', 'accepted_risk', 'invalidated_unsubstantiated'\]\)/);
});
