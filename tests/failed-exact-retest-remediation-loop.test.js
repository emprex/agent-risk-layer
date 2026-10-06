import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

import {
  selectPersistedExactRetestContinuation
} from '../src/agent/tools/resolve-persisted-exact-retest-continuation.mjs';

const fingerprint = 'a'.repeat(64);

function outcome(status, authorisationId = 'roe_base', revision = null) {
  return {
    status,
    authorisationId,
    result: { requestFingerprint: fingerprint },
    campaign: {
      environment: 'local',
      target: {
        mode: 'staging-adapter',
        endpointOrigin: 'http://127.0.0.1:8787',
        endpointPathHash: 'b'.repeat(64),
        profile: null,
        ...(revision ? { revision } : {})
      }
    }
  };
}

test('persisted failed exact retest is selected as the retest lineage', () => {
  const continuation =
    selectPersistedExactRetestContinuation({
      caseId: 'RT-TOOL-004',
      baselines: [
        {
          runId: 'run_baseline',
          createdAt: '2026-10-06T10:00:00.000Z',
          outcome: outcome('failed'),
          lineage: {
            controlId: 'ARL-KB-057',
            findingId: 'rem_1',
            findingStatus: 'in_progress',
            redTeamEvidence: {
              testExecutionId: 'ctx_failed'
            }
          }
        }
      ],
      retests: [
        {
          runId: 'run_failed_retest',
          createdAt: '2026-10-06T11:00:00.000Z',
          outcome: outcome('failed', 'roe_retest'),
          lineage: {
            available: false,
            reason: 'redteam_control_evidence_not_recorded'
          },
          authorisationLineageVerified: true
        }
      ]
    });

  assert.equal(continuation.available, true);
  assert.equal(continuation.retestRunId, 'run_failed_retest');
  assert.equal(continuation.retestStatus, 'failed');
  assert.equal(
    continuation.originalTestExecutionId,
    'ctx_failed'
  );
  assert.equal(continuation.findingId, 'rem_1');
});

test('failed exact retest workflow reopens remediation instead of looping retest', () => {
  const gate = fs.readFileSync(
    new URL('../src/agent/persisted-gate-state.mjs', import.meta.url),
    'utf8'
  );
  const service = fs.readFileSync(
    new URL('../src/control-intelligence-service.js', import.meta.url),
    'utf8'
  );

  assert.match(
    gate,
    /continuation\.retestStatus === 'failed'/
  );
  assert.match(
    gate,
    /stage: 'remediation_required'/
  );
  assert.match(
    gate,
    /name: 'provide_remediation_implementation'/
  );
  assert.match(
    service,
    /recordFailedExactRetestAndInvalidateRemediation/
  );
  assert.match(
    service,
    /lifecycle_state='invalidated'/
  );
  assert.match(
    service,
    /control_intelligence\.failed_exact_retest_recorded/
  );
});


test('persisted retest must match the frozen target revision when one is required', () => {
  const requiredRetestRevision =
    '51c0f5d2e3db933afb3682a0a39ffe5b24024aec';
  const baseline = {
    runId: 'run_baseline',
    createdAt: '2026-10-06T10:00:00.000Z',
    outcome: outcome('failed'),
    lineage: {
      controlId: 'ARL-KB-057',
      findingId: 'rem_1',
      findingStatus: 'evidence_attached',
      redTeamEvidence: {
        testExecutionId: 'ctx_failed'
      }
    }
  };
  const unbound =
    selectPersistedExactRetestContinuation({
      caseId: 'RT-TOOL-004',
      requiredRetestRevision,
      baselines: [baseline],
      retests: [{
        runId: 'run_unbound_retest',
        createdAt: '2026-10-06T11:00:00.000Z',
        outcome: outcome('failed', 'roe_retest'),
        lineage: {
          available: false,
          reason: 'redteam_control_evidence_not_recorded'
        },
        authorisationLineageVerified: true
      }]
    });

  assert.equal(unbound.available, false);
  assert.equal(unbound.reason, 'persisted_exact_retest_not_found');

  const bound =
    selectPersistedExactRetestContinuation({
      caseId: 'RT-TOOL-004',
      requiredRetestRevision,
      baselines: [baseline],
      retests: [{
        runId: 'run_bound_retest',
        createdAt: '2026-10-06T12:00:00.000Z',
        outcome: outcome(
          'failed',
          'roe_retest',
          requiredRetestRevision
        ),
        lineage: {
          available: false,
          reason: 'redteam_control_evidence_not_recorded'
        },
        authorisationLineageVerified: true
      }]
    });

  assert.equal(bound.available, true);
  assert.equal(bound.retestRunId, 'run_bound_retest');
});
