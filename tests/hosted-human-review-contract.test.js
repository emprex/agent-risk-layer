import assert from 'node:assert/strict';
import test from 'node:test';

import {
  humanFindingClosureGate,
  readinessRecordGate
} from '../src/agent/hosted-human-review.mjs';

function workflowState({
  stage,
  name,
  actor = 'human',
  requiresUserInput = true,
  controlId = 'ARL-KB-001',
  caseId = 'RT-TEST-001',
  systemSnapshotId = 'snap_current'
} = {}) {
  return {
    stage,
    nextAllowedAction: {
      name,
      actor,
      requiresUserInput,
      controlId,
      caseId
    },
    authoritativeArtifacts: {
      controlIntelligence: {
        systemSnapshotId
      },
      assessmentContext: {
        systemSnapshotId
      }
    }
  };
}

test(
  'human finding closure requires explicit confirmation at the exact authoritative human gate',
  () => {
    const exact = workflowState({
      stage: 'human_approval_required',
      name: 'record_required_human_approval'
    });

    const missingConfirmation =
      humanFindingClosureGate({
        workflowState: exact,
        confirmed: false
      });

    assert.equal(
      missingConfirmation.available,
      false
    );
    assert.equal(
      missingConfirmation.reason,
      'explicit_human_finding_closure_confirmation_required'
    );
    assert.equal(
      missingConfirmation.securityStateChanged,
      false
    );
    assert.equal(
      missingConfirmation.deploymentDecisionWritten,
      false
    );

    const wrongStage =
      humanFindingClosureGate({
        workflowState: workflowState({
          stage: 'exact_retest_required',
          name: 'authorise_and_run_exact_retest',
          actor: 'user'
        }),
        confirmed: true
      });

    assert.equal(wrongStage.available, false);
    assert.equal(
      wrongStage.reason,
      'authoritative_human_closure_gate_required'
    );

    const approved =
      humanFindingClosureGate({
        workflowState: exact,
        confirmed: true
      });

    assert.equal(approved.available, true);
    assert.equal(
      approved.status,
      'human_closure_gate_satisfied'
    );
    assert.equal(
      approved.action.controlId,
      'ARL-KB-001'
    );
    assert.equal(
      approved.action.caseId,
      'RT-TEST-001'
    );
    assert.equal(
      approved.securityStateChanged,
      false
    );
  }
);

test(
  'readiness record requires explicit authenticated human review, rationale and current authoritative snapshot',
  () => {
    const exact = workflowState({
      stage: 'readiness_review',
      name: 'review_current_arl_readiness'
    });

    const missingConfirmation =
      readinessRecordGate({
        workflowState: exact,
        confirmed: false,
        rationale:
          'Reviewed current ARL readiness.'
      });

    assert.equal(
      missingConfirmation.available,
      false
    );
    assert.equal(
      missingConfirmation.reason,
      'explicit_human_readiness_record_confirmation_required'
    );

    const missingRationale =
      readinessRecordGate({
        workflowState: exact,
        confirmed: true,
        rationale: ''
      });

    assert.equal(
      missingRationale.available,
      false
    );
    assert.equal(
      missingRationale.reason,
      'human_readiness_rationale_required'
    );

    const wrongStage =
      readinessRecordGate({
        workflowState: workflowState({
          stage: 'human_approval_required',
          name: 'record_required_human_approval'
        }),
        confirmed: true,
        rationale:
          'Reviewed current ARL readiness.'
      });

    assert.equal(wrongStage.available, false);
    assert.equal(
      wrongStage.reason,
      'authoritative_readiness_review_gate_required'
    );

    const missingSnapshot =
      readinessRecordGate({
        workflowState: workflowState({
          stage: 'readiness_review',
          name: 'review_current_arl_readiness',
          systemSnapshotId: null
        }),
        confirmed: true,
        rationale:
          'Reviewed current ARL readiness.'
      });

    assert.equal(missingSnapshot.available, false);
    assert.equal(
      missingSnapshot.reason,
      'authoritative_readiness_snapshot_required'
    );

    const approved =
      readinessRecordGate({
        workflowState: exact,
        confirmed: true,
        rationale:
          'Reviewed current ARL readiness and evidence limitations.'
      });

    assert.equal(approved.available, true);
    assert.equal(
      approved.status,
      'human_readiness_record_gate_satisfied'
    );
    assert.equal(
      approved.systemSnapshotId,
      'snap_current'
    );
    assert.equal(
      approved.rationale,
      'Reviewed current ARL readiness and evidence limitations.'
    );
    assert.equal(
      approved.securityStateChanged,
      false
    );
    assert.equal(
      approved.deploymentDecisionWritten,
      false
    );
  }
);
