import test from 'node:test';
import assert from 'node:assert/strict';

import {
  parseLocalHumanEvidenceBatchCommand
} from '../src/agent/local-human-evidence-batch-command.mjs';

function entry(controlId, satisfied = true) {
  return {
    controlId,
    result: satisfied ? 'passed' : 'failed',
    observedResult:
      'The accountable reviewer inspected the authoritative evidence.',
    sourceReference:
      `manual-review:${controlId}`,
    evidenceChecklist: [
      {
        requirement: 'Documented accountable review record',
        evidenceReference:
          `review:${controlId}`,
        observation:
          satisfied
            ? 'The required review record is present and complete.'
            : 'The required review record is missing a required approval.',
        satisfied
      }
    ]
  };
}

test('consolidated human evidence batch parses exact stable batch identity and controls', () => {
  const result =
    parseLocalHumanEvidenceBatchCommand(
      'Record human evidence batch ' +
      JSON.stringify({
        batchId:
          'human_evidence_batch_abcdef123456',
        controls: [
          entry('ARL-KB-010'),
          entry('ARL-KB-011', false)
        ]
      })
    );

  assert.equal(
    result.batchId,
    'human_evidence_batch_abcdef123456'
  );
  assert.deepEqual(
    result.controls.map((item) => item.controlId),
    ['ARL-KB-010', 'ARL-KB-011']
  );
  assert.equal(result.controls[0].result, 'passed');
  assert.equal(result.controls[1].result, 'failed');
});

test('consolidated human evidence batch rejects duplicate controls', () => {
  assert.throws(
    () =>
      parseLocalHumanEvidenceBatchCommand(
        'Record human evidence batch ' +
        JSON.stringify({
          batchId:
            'human_evidence_batch_abcdef123456',
          controls: [
            entry('ARL-KB-010'),
            entry('ARL-KB-010')
          ]
        })
      ),
    /duplicate controlId/
  );
});

test('consolidated human evidence batch rejects positional or malformed batch IDs', () => {
  assert.throws(
    () =>
      parseLocalHumanEvidenceBatchCommand(
        'Record human evidence batch ' +
        JSON.stringify({
          batchId: 'human_evidence_batch_001',
          controls: [
            entry('ARL-KB-010')
          ]
        })
      ),
    /valid stable batchId/
  );
});
