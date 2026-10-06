import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

test('red-team evidence binding accepts explicit equivalent-scope retest reauthorisation lineage', () => {
  const source = fs.readFileSync(
    new URL('../src/control-redteam-evidence.js', import.meta.url),
    'utf8'
  );

  assert.match(source, /verifyExactRetestAuthorisationLineage/);
  assert.match(source, /scopeEquivalent !== true/);
  assert.doesNotMatch(
    source,
    /Baseline and retest runs must use the same Rules of Engagement authorisation\./
  );
});

test('local operator exposes one explicit human review handoff for passed exact retest evidence', () => {
  const source = fs.readFileSync(
    new URL('../src/agent/local-assessment-workflow.mjs', import.meta.url),
    'utf8'
  );

  assert.match(
    source,
    /I have reviewed and verify the exact retest evidence/
  );
  assert.match(
    source,
    /retest_evidence_verification_required/
  );
  assert.match(
    source,
    /provide_verified_retest_evidence/
  );
  assert.match(
    source,
    /completePersistedExactRetest/
  );
});

test('exact retest completion reuses a persisted matching passed retest execution', () => {
  const source = fs.readFileSync(
    new URL('../src/agent/tools/complete-authoritative-redteam-retest.mjs', import.meta.url),
    'utf8'
  );

  assert.match(source, /const existingRetest/);
  assert.match(source, /existingRetest \|\|/);
  assert.match(source, /item\.inputReference ===/);
});
