import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const source = fs.readFileSync(
  new URL('../src/agent/arl-conversation-orchestrator.mjs', import.meta.url),
  'utf8'
);

test('conversation orchestrator preserves an authoritative remediation snapshot gate', () => {
  assert.match(
    source,
    /workflowState\?\.remediationSnapshotGate\?\.active === true/
  );

  const preserveIndex = source.indexOf(
    'workflowState?.remediationSnapshotGate?.active === true'
  );
  const reapplyIndex = source.indexOf(
    'await applyMappedControlAuthorityGuard({',
    preserveIndex
  );

  assert.ok(preserveIndex >= 0);
  assert.ok(reapplyIndex > preserveIndex);
  assert.match(
    source.slice(preserveIndex, reapplyIndex),
    /return result;/
  );
});
