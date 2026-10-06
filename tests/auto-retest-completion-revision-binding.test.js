import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

test('automatic exact retest completion resolves only the frozen target revision', () => {
  const source = fs.readFileSync(
    new URL('../src/agent/authoritative-auto-actions.mjs', import.meta.url),
    'utf8'
  );

  assert.match(
    source,
    /resolvePersistedExactRetestContinuation\([\s\S]*requiredRetestRevision:\s*resolvedPreparation\?\.target\?\.revision \|\| null/
  );
});
