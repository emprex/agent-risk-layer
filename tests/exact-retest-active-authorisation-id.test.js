import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const source = fs.readFileSync(
  new URL('../src/agent/exact-retest-redteam-handoff.mjs', import.meta.url),
  'utf8'
);

test('exact retest reservation uses the selected active reauthorisation id', () => {
  assert.match(
    source,
    /createRedTeamToken\(\{[\s\S]*?mode:\s*'staging',[\s\S]*?authorisationId:\s*authorisation\.id/
  );

  assert.match(
    source,
    /executionPlan:\s*\{[\s\S]*?authorisationId:\s*authorisation\.id/
  );

  assert.doesNotMatch(
    source,
    /mode:\s*'staging',\s*authorisationId\s*\}\)/
  );
});
