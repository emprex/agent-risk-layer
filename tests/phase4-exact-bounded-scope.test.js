import test from 'node:test';
import assert from 'node:assert/strict';

import {
  selectExactBoundedTestCandidate,
  scopeExactBoundedTestState
} from '../src/agent/mapped-control-authority-guard.mjs';

import {
  applyPersistedGateState
} from '../src/agent/persisted-gate-state.mjs';

function projected(controlId, currentStage) {
  return {
    controlId,
    currentStage,
    chainStatus: 'test_required',
    nextAction: `Test ${controlId}`,
    deploymentImpact: 'blocker',
    availableActions: [],
    authorityProjection: true
  };
}

function baseState() {
  return {
    schema: 'arl.agent.workflow-state.v1',
    available: true,
    stage: 'bounded_test_required',
    blocked: true,
    canAutoAdvance: false,
    authoritativeArtifacts: {
      controlIntelligence: {
        available: true,
        relevantControls: []
      }
    },

    // Deliberately stale fallback scope.
    nextAllowedAction: {
      name: 'authorise_and_run_bounded_test',
      actor: 'user',
      requiresUserInput: true,
      controlId: 'ARL-KB-001',
      caseId: 'RT-AUTH-001'
    }
  };
}

test('exact Control Intelligence test scope replaces stale bounded fallback scope', () => {
  const exact = [
    {
      mapping: {
        controlId: 'ARL-KB-001',
        caseId: 'RT-AUTH-001'
      },
      projected: projected(
        'ARL-KB-001',
        'deployment_decision'
      )
    },
    {
      mapping: {
        controlId: 'ARL-KB-057',
        caseId: 'RT-TOOL-004'
      },
      projected: projected(
        'ARL-KB-057',
        'test'
      )
    }
  ];

  const selected =
    selectExactBoundedTestCandidate(exact);

  assert.equal(
    selected.projected.controlId,
    'ARL-KB-057'
  );
  assert.equal(
    selected.mapping.caseId,
    'RT-TOOL-004'
  );

  const state = scopeExactBoundedTestState({
    workflowState: baseState(),
    selected,
    exactControls:
      exact.map((item) => item.projected)
  });

  assert.equal(
    state.nextAllowedAction.controlId,
    'ARL-KB-057'
  );
  assert.equal(
    state.nextAllowedAction.caseId,
    'RT-TOOL-004'
  );
  assert.equal(
    state.scopedControl.controlId,
    'ARL-KB-057'
  );
  assert.equal(
    state.mappedControlAuthorityGuard
      .exactBoundedTestScope,
    true
  );
});

test('multiple executable exact tests use stable control ordering', () => {
  const exact = [
    {
      mapping: {
        controlId: 'ARL-KB-090',
        caseId: 'RT-Z-090'
      },
      projected: projected(
        'ARL-KB-090',
        'test'
      )
    },
    {
      mapping: {
        controlId: 'ARL-KB-057',
        caseId: 'RT-TOOL-004'
      },
      projected: projected(
        'ARL-KB-057',
        'test'
      )
    }
  ];

  const selected =
    selectExactBoundedTestCandidate(exact);

  assert.equal(
    selected.projected.controlId,
    'ARL-KB-057'
  );
});

test('a test-stage control without an executable case is not selected', () => {
  const selected =
    selectExactBoundedTestCandidate([
      {
        mapping: {
          controlId: 'ARL-KB-090',
          caseId: null
        },
        projected: projected(
          'ARL-KB-090',
          'test'
        )
      }
    ]);

  assert.equal(selected, null);
});

test('persisted bounded result advances after exact scope replaces stale fallback', async () => {
  const exact = [
    {
      mapping: {
        questionId: 'tool_authorization',
        controlId: 'ARL-KB-001',
        caseId: 'RT-AUTH-001'
      },
      projected: projected(
        'ARL-KB-001',
        'deployment_decision'
      )
    },
    {
      mapping: {
        questionId: 'egress_control',
        controlId: 'ARL-KB-057',
        caseId: 'RT-TOOL-004'
      },
      projected: projected(
        'ARL-KB-057',
        'test'
      )
    }
  ];

  const selected =
    selectExactBoundedTestCandidate(exact);

  const stale = baseState();

  const exactScoped =
    scopeExactBoundedTestState({
      workflowState: {
        ...stale,
        authoritativeArtifacts: {
          ...stale.authoritativeArtifacts,
          evidencePlan: {
            available: true,
            state: 'bounded_checks_required',
            mappedControls:
              exact.map((item) => item.mapping)
          }
        }
      },
      selected,
      exactControls:
        exact.map((item) => item.projected)
    });

  let resolverArgs = null;

  const promoted =
    await applyPersistedGateState({
      workflowState: exactScoped,
      projectId: 'prj_test',
      userId: 'usr_test',
      assessmentId: 'asm_test',

      resolveBoundedContinuation:
        async (args) => {
          resolverArgs = args;

          return {
            available: true,
            persisted: false,
            runId: 'rtr_test',
            caseId: 'RT-TOOL-004',
            controlId: 'ARL-KB-057',
            selectionBasis:
              'unique_unrecorded_authoritative_run'
          };
        },

      resolveExactRetestContinuation:
        async () => ({
          available: false,
          reason:
            'persisted_exact_retest_not_found'
        })
    });

  assert.equal(
    resolverArgs.controlId,
    'ARL-KB-057'
  );

  assert.equal(
    resolverArgs.caseId,
    'RT-TOOL-004'
  );

  assert.equal(
    promoted.stage,
    'evidence_recording_required'
  );

  assert.equal(
    promoted.nextAllowedAction.name,
    'record_authoritative_evidence'
  );

  assert.equal(
    promoted.nextAllowedAction.actor,
    'arl'
  );

  assert.equal(
    promoted.nextAllowedAction.requiresUserInput,
    false
  );
});
