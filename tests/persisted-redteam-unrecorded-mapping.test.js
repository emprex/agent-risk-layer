import test from 'node:test';
import assert from 'node:assert/strict';

import {
  mappedControlIdForCase
} from '../src/agent/tools/resolve-persisted-redteam-continuation.mjs';

test('unrecorded Red Team case resolves control through authoritative assessment binding', () => {
  const evidencePlan = {
    available: true,
    checks: [
      {
        caseId: 'RT-TOOL-004',
        gap: {
          questionId: 'egress_control'
        }
      }
    ]
  };

  assert.equal(
    mappedControlIdForCase(
      evidencePlan,
      'RT-TOOL-004'
    ),
    'ARL-KB-057'
  );
});

test('unrecorded Red Team case fails closed on missing or ambiguous mappings', () => {
  assert.equal(
    mappedControlIdForCase(
      {
        available: true,
        checks: [
          {
            caseId: 'RT-UNKNOWN-001',
            gap: {
              questionId: 'not_mapped'
            }
          }
        ]
      },
      'RT-UNKNOWN-001'
    ),
    null
  );

  assert.equal(
    mappedControlIdForCase(
      {
        available: true,
        checks: [
          {
            caseId: 'RT-TOOL-004',
            controlId: 'ARL-KB-057'
          },
          {
            caseId: 'RT-TOOL-004',
            controlId: 'ARL-KB-090'
          }
        ]
      },
      'RT-TOOL-004'
    ),
    null
  );
});
