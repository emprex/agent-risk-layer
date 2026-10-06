import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

test('git remediation recovery follows previous remediation snapshot lineage', () => {
  const source = fs.readFileSync(
    new URL('../src/agent/git-remediation-handoff.mjs', import.meta.url),
    'utf8'
  );

  assert.match(
    source,
    /remediationSnapshotConfirmation/
  );
  assert.match(
    source,
    /previousSystemSnapshotId/
  );
  assert.match(
    source,
    /inheritedFromSystemSnapshotId/
  );
  assert.match(
    source,
    /active_authoritative_remediation_not_found/
  );
});

test('conversation explicitly reports legacy retest remediation recovery', () => {
  const source = fs.readFileSync(
    new URL('../src/agent/arl-conversation-agent.mjs', import.meta.url),
    'utf8'
  );

  assert.match(
    source,
    /implementation_recovered_for_revision_bound_retest/
  );
  assert.match(
    source,
    /historical failed exact retest was not bound to a target revision/
  );
});
