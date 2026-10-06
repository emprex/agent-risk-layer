import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

test('mapped-control guard prioritises one active remediation over unrelated applicability reviews', () => {
  const source = fs.readFileSync(
    new URL('../src/agent/mapped-control-authority-guard.mjs', import.meta.url),
    'utf8'
  );

  const remediationIndex =
    source.indexOf("const remediationCandidates =");
  const applicabilityIndex =
    source.indexOf("const applicability =");

  assert.notEqual(remediationIndex, -1);
  assert.notEqual(applicabilityIndex, -1);
  assert.ok(
    remediationIndex < applicabilityIndex,
    'active remediation must be resolved before generic applicability ambiguity'
  );

  assert.match(
    source,
    /if \(remediationCandidates\.length === 1\)[\s\S]*?scopeExactRemediationState/
  );

  assert.match(
    source,
    /mapped_control_applicability_ambiguous/
  );
});
