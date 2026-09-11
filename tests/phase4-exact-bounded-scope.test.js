import test from 'node:test';
import assert from 'node:assert/strict';

import {
  selectExactBoundedTestCandidate,
  scopeExactBoundedTestState
} from '../src/agent/mapped-control-authority-guard.mjs';

import {
  applyPersistedGateState
} from '../src/agent/persisted-gate-state.mjs';

import {
  selectPersistedRedTeamContinuation
} from '../src/agent/tools/resolve-persisted-redteam-continuation.mjs';

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


test('persisted lineage ambiguity requires and validates explicit human run selection', async () => {
  const candidates = [
    {
      runId: 'rtr_old',
      caseId: 'RT-TOOL-004',
      controlId: 'ARL-KB-057',
      persisted: true,
      createdAt: '2026-09-11T09:00:00.000Z'
    },
    {
      runId: 'rtr_current',
      caseId: 'RT-TOOL-004',
      controlId: 'ARL-KB-057',
      persisted: true,
      createdAt: '2026-09-11T10:00:00.000Z'
    }
  ];

  const ambiguous =
    selectPersistedRedTeamContinuation(candidates);

  assert.equal(ambiguous.available, false);
  assert.equal(
    ambiguous.reason,
    'persisted_redteam_lineage_ambiguous'
  );
  assert.equal(ambiguous.candidateCount, 2);

  const selected =
    selectPersistedRedTeamContinuation(
      candidates,
      'rtr_current'
    );

  assert.equal(selected.available, true);
  assert.equal(selected.runId, 'rtr_current');
  assert.equal(
    selected.selectionBasis,
    'human_selected_authoritative_run'
  );

  const invalid =
    selectPersistedRedTeamContinuation(
      candidates,
      'rtr_not_a_candidate'
    );

  assert.equal(invalid.available, false);
  assert.equal(
    invalid.reason,
    'persisted_redteam_selection_invalid'
  );

  const state = baseState();
  state.authoritativeArtifacts.evidencePlan = {
    available: true,
    state: 'bounded_checks_required',
    mappedControls: [
      {
        questionId: 'egress_control',
        controlId: 'ARL-KB-057',
        caseId: 'RT-TOOL-004'
      }
    ]
  };
  state.nextAllowedAction.controlId = 'ARL-KB-057';
  state.nextAllowedAction.caseId = 'RT-TOOL-004';

  let resolverArgs = null;

  const promoted = await applyPersistedGateState({
    workflowState: state,
    projectId: 'prj_test',
    userId: 'usr_test',
    assessmentId: 'asm_test',
    selectedRunId: 'rtr_current',

    resolveBoundedContinuation: async (args) => {
      resolverArgs = args;

      return {
        available: true,
        persisted: true,
        runId: 'rtr_current',
        caseId: 'RT-TOOL-004',
        controlId: 'ARL-KB-057',
        selectionBasis:
          'human_selected_authoritative_run'
      };
    },

    resolveExactRetestContinuation: async () => ({
      available: false,
      reason: 'persisted_exact_retest_not_found'
    })
  });

  assert.equal(
    resolverArgs.selectedRunId,
    'rtr_current'
  );

  assert.equal(
    promoted.stage,
    'evidence_recording_required'
  );

  assert.equal(
    promoted.nextAllowedAction.selectedRunId,
    'rtr_current'
  );
});
