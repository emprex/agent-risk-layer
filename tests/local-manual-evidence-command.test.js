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


test('conclusive manual evidence requires a structured evidence checklist', () => {
  assert.throws(
    () =>
      parseLocalManualEvidenceCommand(
        'Record manual evidence ' +
        JSON.stringify({
          controlId: 'ARL-KB-090',
          result: 'passed',
          observedResult:
            'The operator states that reconstruction requirements are satisfied.',
          sourceReference:
            'manual-review:test'
        })
      ),
    /requires evidenceChecklist entries/
  );
});

test('conclusive manual evidence parses bounded checklist items', () => {
  const result =
    parseLocalManualEvidenceCommand(
      'Record manual evidence ' +
      JSON.stringify({
        controlId: 'ARL-KB-090',
        result: 'passed',
        observedResult:
          'The reviewed records support the asserted control outcome.',
        sourceReference:
          'manual-review:test',
        evidenceChecklist: [
          {
            requirement:
              'Documented audit reconstruction record',
            evidenceReference:
              'policy:audit-record-1',
            observation:
              'The record contains the required reconstruction fields.',
            satisfied: true
          }
        ]
      })
    );

  assert.equal(result.result, 'passed');
  assert.equal(result.evidenceChecklist.length, 1);
  assert.equal(
    result.evidenceChecklist[0].evidenceReference,
    'policy:audit-record-1'
  );
});


test('conclusive manual evidence derives failed when any canonical checklist item is unsatisfied', () => {
  const result =
    parseLocalManualEvidenceCommand(
      'Record manual evidence ' +
      JSON.stringify({
        controlId: 'ARL-KB-090',
        result: 'failed',
        observedResult:
          'One required evidence item is not satisfied.',
        sourceReference:
          'manual-review:test',
        evidenceChecklist: [
          {
            requirement:
              'Documented audit reconstruction record',
            evidenceReference:
              'policy:audit-record-1',
            observation:
              'The record is missing the required actor identity field.',
            satisfied: false
          }
        ]
      })
    );

  assert.equal(result.result, 'failed');
});

test('manual evidence rejects a claimed pass when the checklist deterministically derives failure', () => {
  assert.throws(
    () =>
      parseLocalManualEvidenceCommand(
        'Record manual evidence ' +
        JSON.stringify({
          controlId: 'ARL-KB-090',
          result: 'passed',
          observedResult:
            'The operator attempted to claim a pass.',
          sourceReference:
            'manual-review:test',
          evidenceChecklist: [
            {
              requirement:
                'Documented audit reconstruction record',
              evidenceReference:
                'policy:audit-record-1',
              observation:
                'The record is missing the required actor identity field.',
              satisfied: false
            }
          ]
        })
      ),
    /deterministically derives failed/
  );
});

test('conclusive manual evidence requires boolean checklist satisfaction assertions', () => {
  assert.throws(
    () =>
      parseLocalManualEvidenceCommand(
        'Record manual evidence ' +
        JSON.stringify({
          controlId: 'ARL-KB-090',
          result: 'passed',
          observedResult:
            'The operator supplied evidence without a structured satisfaction value.',
          sourceReference:
            'manual-review:test',
          evidenceChecklist: [
            {
              requirement:
                'Documented audit reconstruction record',
              evidenceReference:
                'policy:audit-record-1',
              observation:
                'The record contains the required reconstruction fields.'
            }
          ]
        })
      ),
    /requires a boolean satisfied value/
  );
});
