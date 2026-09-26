import test from 'node:test';
import assert from 'node:assert/strict';

import {
  parseLocalApplicabilityCommand
} from '../src/agent/local-applicability-command.mjs';

test('keeps the existing positive applicability shorthand', () => {
  assert.deepEqual(
    parseLocalApplicabilityCommand('Control ARL-KB-057 applies'),
    {
      controlId: 'ARL-KB-057',
      decision: 'applicable',
      reason: 'Explicit local human applicability review',
      architectureFactIds: null
    }
  );
});

test('parses explicit not-applicable decisions with human rationale and confirmed facts', () => {
  assert.deepEqual(
    parseLocalApplicabilityCommand(
      'Set control applicability {"controlId":"ARL-KB-046","decision":"not_applicable","reason":"The frozen target has no cross-session agent memory.","architectureFactIds":["memory:no_cross_session_persistence"]}'
    ),
    {
      controlId: 'ARL-KB-046',
      decision: 'not_applicable',
      reason: 'The frozen target has no cross-session agent memory.',
      architectureFactIds: ['memory:no_cross_session_persistence']
    }
  );
});

test('parses context-required decisions without inventing facts', () => {
  assert.deepEqual(
    parseLocalApplicabilityCommand(
      'Set control applicability {"controlId":"ARL-KB-090","decision":"context_required","reason":"Audit reconstruction scope needs further human review."}'
    ),
    {
      controlId: 'ARL-KB-090',
      decision: 'context_required',
      reason: 'Audit reconstruction scope needs further human review.',
      architectureFactIds: null
    }
  );
});

test('not-applicable decisions fail closed without a supporting confirmed fact', () => {
  assert.throws(
    () => parseLocalApplicabilityCommand(
      'Set control applicability {"controlId":"ARL-KB-046","decision":"not_applicable","reason":"No persistent memory is present."}'
    ),
    /requires at least one confirmed supporting architecture fact/i
  );
});

test('invalid decisions fail closed', () => {
  assert.throws(
    () => parseLocalApplicabilityCommand(
      'Set control applicability {"controlId":"ARL-KB-057","decision":"probably","reason":"This is deliberately invalid."}'
    ),
    /decision must be applicable, not_applicable, or context_required/i
  );
});
