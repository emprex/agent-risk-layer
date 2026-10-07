import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));

test('accountable applicability projection recognises both guided and local-owner decisions', () => {
  const source = fs.readFileSync(
    path.join(root, 'src/control-intelligence-core.js'),
    'utf8'
  );

  assert.match(
    source,
    /\['guided_customer_review','local_owner_attestation'\]\.includes\(evaluation\.decision_method\)/
  );

  assert.match(
    source,
    /evaluation\.applicability_status==='not_applicable'&&reviewed\)\{notRequiredStages\.push\('test','evidence','finding','remediation','retest','approval'\);currentStage='deployment_decision'/
  );
});
