import test from 'node:test';
import assert from 'node:assert/strict';

import {
  selectPersistedExactRetestContinuation
} from '../src/agent/tools/resolve-persisted-exact-retest-continuation.mjs';

const fingerprint = 'a'.repeat(64);
const target = {
  mode: 'staging-adapter',
  environment: 'local',
  endpointOrigin: 'http://127.0.0.1:8787',
  endpointPathHash: 'b'.repeat(64),
  profile: null
};

function outcome(status, authorisationId = 'roe_1') {
  return {
    status,
    caseId: 'RT-TOOL-004',
    authorisationId,
    result: { requestFingerprint: fingerprint },
    campaign: {
      environment: target.environment,
      target: {
        mode: target.mode,
        endpointOrigin: target.endpointOrigin,
        endpointPathHash: target.endpointPathHash,
        profile: target.profile
      }
    }
  };
}

function baseline(runId, createdAt) {
  return {
    runId,
    createdAt,
    outcome: outcome('failed'),
    lineage: {
      controlId: 'ARL-KB-057',
      findingId: 'rem_1',
      findingStatus: 'in_progress',
      redTeamEvidence: {
        executionKind: 'initial',
        testExecutionId: 'ctx_failed'
      }
    }
  };
}

test('equivalent initial failed baselines collapse to one semantic lineage', () => {
  const result =
    selectPersistedExactRetestContinuation({
      caseId: 'RT-TOOL-004',
      baselines: [
        baseline('run_b', '2026-10-06T10:05:00.000Z'),
        baseline('run_a', '2026-10-06T10:00:00.000Z')
      ],
      retests: [
        {
          runId: 'run_retest',
          createdAt: '2026-10-06T11:00:00.000Z',
          outcome: outcome('failed', 'roe_2'),
          lineage: {
            available: false,
            reason: 'redteam_control_evidence_not_recorded'
          },
          authorisationLineageVerified: true
        }
      ]
    });

  assert.equal(result.available, true);
  assert.equal(result.baselineRunId, 'run_a');
  assert.deepEqual(
    result.equivalentBaselineRunIds,
    ['run_a', 'run_b']
  );
  assert.equal(result.retestStatus, 'failed');
});

test('materially different failed baselines remain ambiguous', () => {
  const other = baseline(
    'run_other',
    '2026-10-06T10:10:00.000Z'
  );
  other.lineage.findingId = 'rem_2';

  const result =
    selectPersistedExactRetestContinuation({
      caseId: 'RT-TOOL-004',
      baselines: [
        baseline('run_a', '2026-10-06T10:00:00.000Z'),
        other
      ],
      retests: []
    });

  assert.equal(result.available, false);
  assert.equal(
    result.reason,
    'persisted_failed_redteam_baseline_ambiguous'
  );
});
