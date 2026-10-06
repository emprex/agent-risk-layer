import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const paths = [
  '../src/agent/active-remediation-lineage.mjs',
  '../src/agent/remediation-applicability-handoff.mjs',
  '../src/agent/persisted-gate-state.mjs'
];

for (const relativePath of paths) {
  test(`PostgreSQL DISTINCT remediation ordering projects its ORDER BY column: ${relativePath}`, () => {
    const source = fs.readFileSync(
      new URL(relativePath, import.meta.url),
      'utf8'
    );

    assert.match(
      source,
      /r\.updated_at AS finding_updated_at/
    );

    assert.match(
      source,
      /ORDER BY finding_updated_at DESC,finding_id/
    );

    assert.doesNotMatch(
      source,
      /SELECT DISTINCT[\s\S]*?ORDER BY r\.updated_at DESC,r\.id/
    );
  });
}
