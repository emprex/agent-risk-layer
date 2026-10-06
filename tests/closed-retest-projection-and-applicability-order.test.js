import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

test('closed finding is not reopened by an older failed retest once a later exact pass supersedes it', () => {
  const source = fs.readFileSync(
    new URL('../src/control-intelligence-core.js', import.meta.url),
    'utf8'
  );

  assert.match(source, /failedRetestSuperseded/);
  assert.match(source, /\['verified_closed','accepted_risk'\]\.includes\(finding\.status\)/);
  assert.match(source, /candidate\.retest_of_execution_id!==row\.retest_of_execution_id/);
  assert.match(source, /passedAt>=failedAt/);
  assert.match(
    source,
    /row\.result === 'failed'\s*&&\s*!failedRetestSuperseded\(row, historicalTests, findings\)/
  );
});

test('multiple ordinary applicability controls are sequenced deterministically instead of reported as lineage ambiguity', () => {
  const source = fs.readFileSync(
    new URL('../src/agent/mapped-control-authority-guard.mjs', import.meta.url),
    'utf8'
  );

  assert.doesNotMatch(
    source,
    /reason:\s*['"]mapped_control_applicability_ambiguous['"]/
  );
  assert.match(
    source,
    /\[\.\.\.applicability\]\.sort/
  );
  assert.match(
    source,
    /localeCompare\(String\(right\.projected\.controlId\)\)/
  );
});
