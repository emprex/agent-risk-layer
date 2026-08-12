import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const source = readFileSync(new URL('../public/control-intelligence-control.js', import.meta.url), 'utf8');

test('test-result confirmation does not turn inconclusive evidence into a finding', () => {
  assert.match(
    source,
    /Test result saved\./,
  );
  assert.match(
    source,
    /Attach evidence to the executed test\./,
  );
  assert.doesNotMatch(
    source,
    /Test result saved\. Create a finding to review the failure\./,
  );
});
