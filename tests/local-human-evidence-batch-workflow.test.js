import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root =
  fileURLToPath(new URL('../', import.meta.url));

test('local assessment accepts only the exact current authoritative human evidence batch', () => {
  const source = fs.readFileSync(
    path.join(root, 'src/agent/local-assessment-workflow.mjs'),
    'utf8'
  );

  assert.match(
    source,
    /parseLocalHumanEvidenceBatchCommand/
  );

  assert.match(
    source,
    /queue\?\.humanReviewBatches/
  );

  assert.match(
    source,
    /batch\.controlIds\.includes\(scopedControlId\)/
  );

  assert.match(
    source,
    /Human evidence batch must contain exactly the controls in the current authoritative batch/
  );

  assert.match(
    source,
    /detail\?\.systemSnapshot\?\.id !== snapshotId/
  );

  assert.match(
    source,
    /executionMethod:\s*'consolidated_human_review'/
  );

  assert.match(
    source,
    /verificationScope:\s*'explicit_consolidated_human_control_review'/
  );
});
