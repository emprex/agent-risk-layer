import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const source = fs.readFileSync(
  new URL(
    '../src/agent/local-assessment-workflow.mjs',
    import.meta.url
  ),
  'utf8'
);

test('local workflow exposes explicit active-test authorisation and result commands', () => {
  assert.match(
    source,
    /Authorise active control test/
  );
  assert.match(
    source,
    /active_test_plan_required/
  );
  assert.match(
    source,
    /active_test_plan_authorisation/
  );
  assert.match(
    source,
    /Execute authorised active control test/
  );
  assert.match(
    source,
    /RT-DATA-001/
  );
  assert.match(
    source,
    /authorised_local_active_test/
  );
  assert.match(
    source,
    /Record active control test result/
  );
  assert.match(
    source,
    /authorised_active_test_execution_required/
  );
  assert.match(
    source,
    /authorised_manual_active_test/
  );
  assert.match(
    source,
    /authorised_active_test_result/
  );
  assert.match(
    source,
    /verificationState === 'verified'/
  );
});
