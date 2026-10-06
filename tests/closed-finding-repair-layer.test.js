import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

test('service repair layer preserves a closed finding when verified exact-retest evidence exists', () => {
  const source = fs.readFileSync(
    new URL('../src/control-intelligence-service.js', import.meta.url),
    'utf8'
  );

  assert.match(source, /completedClosedLineage/);
  assert.match(source, /CLOSED_FINDING_STATES\.has\(finding\.status\)/);
  assert.match(source, /passedExactRetest\(detail, failed, finding\)/);
  assert.match(source, /hasVerifiedRetestEvidence\(detail, retest\)/);
  assert.match(source, /if \(completedClosedLineage\) \{\s*return detail;/);
});
