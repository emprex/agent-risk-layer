import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const source = fs.readFileSync(
  new URL('../src/agent/arl-conversation-agent.mjs', import.meta.url),
  'utf8'
);

test('exact mapped control scope is applied before persisted gate continuation', () => {
  const exactIndex = source.indexOf(
    'const exactScopedState =\n        await applyMappedControlAuthorityGuard'
  );
  const persistedIndex = source.indexOf(
    'return applyPersistedGateState({\n        workflowState: exactScopedState'
  );

  assert.notEqual(exactIndex, -1);
  assert.notEqual(persistedIndex, -1);
  assert.ok(
    exactIndex < persistedIndex,
    'persisted Red Team continuation must use the exact scoped control/case rather than a stale evidence-plan fallback'
  );
});
