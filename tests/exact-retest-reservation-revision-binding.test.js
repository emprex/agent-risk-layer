import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

test('exact retest reservation preserves frozen revision through persistence', () => {
  const source = fs.readFileSync(
    new URL('../src/agent/exact-retest-redteam-handoff.mjs', import.meta.url),
    'utf8'
  );

  assert.match(
    source,
    /requiredRetestRevision:\s*workflowState\?\.authoritativeArtifacts\s*\?\.frozenTarget\?\.revision/
  );

  assert.match(
    source,
    /requiredRetestRevision:\s*continuationContext\.requiredRetestRevision \|\| null/
  );
});
