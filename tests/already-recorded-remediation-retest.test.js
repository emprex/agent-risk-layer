import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

test('already-recorded remediation with ready changed snapshot advances to exact retest', () => {
  const source = fs.readFileSync(
    new URL('../src/agent/git-remediation-handoff.mjs', import.meta.url),
    'utf8'
  );

  assert.match(source, /remediatedSnapshotReady/);
  assert.match(source, /already_recorded_exact_retest_required/);
  assert.match(source, /remediation_and_changed_snapshot_already_recorded/);
  assert.match(source, /revision_bound_exact_retest_required/);
});

test('legacy finding status does not bypass unbound retest recovery', () => {
  const source = fs.readFileSync(
    new URL('../src/agent/git-remediation-handoff.mjs', import.meta.url),
    'utf8'
  );

  assert.doesNotMatch(
    source,
    /remediation\.finding\?\.status === 'evidence_attached'/
  );

  const recoveryIndex = source.indexOf(
    'recoverLegacyUnboundRetestImplementation'
  );
  const recordIndex = source.indexOf(
    'recordAuthoritativeRemediationImplementation'
  );

  assert.notEqual(recoveryIndex, -1);
  assert.notEqual(recordIndex, -1);
});

test('conversation reports exact retest instead of duplicate snapshot capture', () => {
  const source = fs.readFileSync(
    new URL('../src/agent/arl-conversation-agent.mjs', import.meta.url),
    'utf8'
  );

  assert.match(source, /already_recorded_exact_retest_required/);
  assert.match(source, /changed system snapshot are already recorded/);
  assert.match(source, /revision-bound exact retest is now required/);
});
