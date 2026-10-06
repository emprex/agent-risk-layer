import test from 'node:test';
import assert from 'node:assert/strict';

import {
  parseLocalManualEvidenceCommand
} from '../src/agent/local-manual-evidence-command.mjs';

test('non manual-evidence request is ignored', () => {
  assert.equal(
    parseLocalManualEvidenceCommand('Where are we?'),
    null
  );
});

test('valid manual evidence command is parsed', () => {
  const result =
    parseLocalManualEvidenceCommand(
      'Record manual evidence ' +
      JSON.stringify({
        controlId: 'ARL-KB-090',
        result: 'inconclusive',
        observedResult:
          'Source inspection does not yet prove complete audit reconstruction.',
        sourceReference:
          'manual-review:ARL-KB-090',
        limitations:
          'Source review only.'
      })
    );

  assert.equal(result.controlId, 'ARL-KB-090');
  assert.equal(result.result, 'inconclusive');
  assert.match(
    result.observedResult,
    /audit reconstruction/
  );
});

test('manual evidence rejects unsupported results', () => {
  assert.throws(
    () =>
      parseLocalManualEvidenceCommand(
        'Record manual evidence ' +
        JSON.stringify({
          controlId: 'ARL-KB-090',
          result: 'approved',
          observedResult:
            'This is deliberately not a supported result.',
          sourceReference:
            'manual-review:test'
        })
      ),
    /passed, failed, or inconclusive/
  );
});

test('manual evidence requires a valid control id', () => {
  assert.throws(
    () =>
      parseLocalManualEvidenceCommand(
        'Record manual evidence ' +
        JSON.stringify({
          controlId: 'BAD',
          result: 'failed',
          observedResult:
            'Audit reconstruction requirements were not satisfied.',
          sourceReference:
            'manual-review:test'
        })
      ),
    /ARL-KB-###/
  );
});
