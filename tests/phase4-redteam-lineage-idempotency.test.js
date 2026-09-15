import test from 'node:test';
import assert from 'node:assert/strict';

import {
  redTeamEvidenceSemanticKey
} from '../src/agent/tools/get-authoritative-redteam-lineage.mjs';

test('duplicate persisted rows for the same Red Team lineage are semantically equivalent', () => {
  const sourceReference =
    'redteam:rtr_same:RT-TOOL-004:digest123';

  const evidenceA = {
    id: 'evidence-a',
    sourceType: 'redteam_run',
    sourceReference,
    verificationState: 'verified',
    retentionStatus: 'active'
  };

  const evidenceB = {
    id: 'evidence-b',
    sourceType: 'redteam_run',
    sourceReference,
    verificationState: 'verified',
    retentionStatus: 'active'
  };

  const executionA = {
    id: 'execution-a',
    systemSnapshotId: 'snapshot-1',
    result: 'failed',
    executionKind: 'test',
    executionMethod: 'bounded_redteam',
    inputReference: 'RT-TOOL-004:digest123',
    expectedResult: 'denied',
    observedResult: 'policy failure',
    failureReason: 'RT-TOOL-004'
  };

  const executionB = {
    ...executionA,
    id: 'execution-b'
  };

  assert.equal(
    redTeamEvidenceSemanticKey({
      evidenceItem: evidenceA,
      execution: executionA
    }),
    redTeamEvidenceSemanticKey({
      evidenceItem: evidenceB,
      execution: executionB
    })
  );

  assert.notEqual(
    redTeamEvidenceSemanticKey({
      evidenceItem: evidenceA,
      execution: executionA
    }),
    redTeamEvidenceSemanticKey({
      evidenceItem: evidenceB,
      execution: {
        ...executionB,
        result: 'passed'
      }
    })
  );
});
