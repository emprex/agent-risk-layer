import test from 'node:test';
import assert from 'node:assert/strict';

import {
  selectHostedApplicabilityWorkflowState
} from '../src/agent/hosted-applicability-confirmation.mjs';

function state({ guard = null } = {}) {
  return {
    stage: 'persisted_lineage_resolution_required',
    ...(guard ? { mappedControlAuthorityGuard: guard } : {}),
    authoritativeArtifacts: {
      evidencePlan: {
        mappedControls: [
          { controlId: 'ARL-KB-046', caseId: 'CASE-046' },
          { controlId: 'ARL-KB-057', caseId: 'CASE-057' }
        ]
      },
      controlIntelligence: {
        relevantControls: [
          {
            controlId: 'ARL-KB-046',
            currentStage: 'applicability',
            chainStatus: 'context_required',
            nextAction: 'Provide missing architecture information and confirm applicability.',
            deploymentImpact: 'hold'
          },
          {
            controlId: 'ARL-KB-057',
            currentStage: 'applicability',
            chainStatus: 'context_required',
            nextAction: 'Provide missing architecture information and confirm applicability.',
            deploymentImpact: 'hold'
          }
        ]
      }
    }
  };
}

test('displayed authoritative applicability candidate remains selectable after workflow reconstruction', () => {
  const selected = selectHostedApplicabilityWorkflowState(
    state(),
    'ARL-KB-046'
  );

  assert.equal(selected?.stage, 'control_applicability_required');
  assert.equal(selected?.scopedControl?.controlId, 'ARL-KB-046');
  assert.equal(selected?.nextAllowedAction?.name, 'resolve_control_applicability');
  assert.equal(selected?.nextAllowedAction?.actor, 'user');
  assert.equal(selected?.nextAllowedAction?.requiresUserInput, true);
});

test('selection does not depend on transient ambiguity guard metadata', () => {
  const selected = selectHostedApplicabilityWorkflowState(
    state({
      guard: {
        ambiguity: true,
        reason: 'some_other_persisted_lineage_reason'
      }
    }),
    'ARL-KB-057'
  );

  assert.equal(selected?.scopedControl?.controlId, 'ARL-KB-057');
});


test('mapped control remains selectable when reconstructed projection omits applicability candidates', () => {
  const reconstructed = state();
  reconstructed.stage = 'target_context_binding_required';
  reconstructed.authoritativeArtifacts.controlIntelligence.relevantControls = [];

  const selected = selectHostedApplicabilityWorkflowState(
    reconstructed,
    'ARL-KB-046'
  );

  assert.equal(selected?.stage, 'control_applicability_required');
  assert.equal(selected?.scopedControl?.controlId, 'ARL-KB-046');
  assert.equal(selected?.nextAllowedAction?.name, 'resolve_control_applicability');
});

test('authoritative preparation mapping survives workflow projection loss', () => {
  const reconstructed = state();
  reconstructed.authoritativeArtifacts.evidencePlan.mappedControls = [];
  reconstructed.authoritativeArtifacts.controlIntelligence.relevantControls = [];

  const selected = selectHostedApplicabilityWorkflowState(
    reconstructed,
    'ARL-KB-046',
    {
      evidencePlan: {
        checks: [
          {
            id: 'CHECK-MEMORY',
            questionId: 'memory_security'
          }
        ],
        manual: []
      }
    }
  );

  assert.equal(selected?.stage, 'control_applicability_required');
  assert.equal(selected?.scopedControl?.controlId, 'ARL-KB-046');
  assert.equal(selected?.nextAllowedAction?.name, 'resolve_control_applicability');
});

test('explicit displayed mapped control overrides a different reconstructed scoped control', () => {
  const reconstructed = state();
  reconstructed.stage = 'control_applicability_required';
  reconstructed.scopedControl = {
    controlId: 'ARL-KB-057',
    currentStage: 'applicability',
    chainStatus: 'context_required'
  };
  reconstructed.nextAllowedAction = {
    name: 'resolve_control_applicability',
    actor: 'user',
    requiresUserInput: true,
    controlId: 'ARL-KB-057'
  };

  const selected = selectHostedApplicabilityWorkflowState(
    reconstructed,
    'ARL-KB-046'
  );

  assert.equal(selected?.stage, 'control_applicability_required');
  assert.equal(selected?.scopedControl?.controlId, 'ARL-KB-046');
  assert.equal(selected?.nextAllowedAction?.controlId, 'ARL-KB-046');
});

test('unknown or non-mapped control cannot be selected', () => {
  assert.equal(
    selectHostedApplicabilityWorkflowState(state(), 'ARL-KB-999'),
    null
  );
});
