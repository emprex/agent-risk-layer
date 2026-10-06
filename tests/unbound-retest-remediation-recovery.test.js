import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

import {
  scopeExactRetestState
} from '../src/agent/mapped-control-authority-guard.mjs';

test('exact retest lineage remains scoped even when unrelated controls still need applicability', () => {
  const workflowState = {
    schema: 'arl.agent.workflow-state.v1',
    available: true,
    stage: 'control_applicability_required',
    authoritativeArtifacts: {
      controlIntelligence: {
        available: true,
        relevantControls: []
      }
    }
  };

  const selected = {
    mapping: {
      controlId: 'ARL-KB-057',
      caseId: 'RT-TOOL-004'
    },
    projected: {
      controlId: 'ARL-KB-057',
      currentStage: 'retest',
      chainStatus: 'remediation_in_progress',
      nextAction:
        'Retest the exact original failure against the remediated snapshot.',
      deploymentImpact: 'blocker',
      remediationState: {
        implementationRecorded: true,
        remediatedSnapshotReady: true
      }
    }
  };

  const state = scopeExactRetestState({
    workflowState,
    selected,
    exactControls: [
      selected.projected,
      {
        controlId: 'ARL-KB-046',
        currentStage: 'applicability'
      },
      {
        controlId: 'ARL-KB-090',
        currentStage: 'applicability'
      },
      {
        controlId: 'ARL-KB-100',
        currentStage: 'applicability'
      }
    ]
  });

  assert.equal(state.stage, 'exact_retest_required');
  assert.equal(state.scopedControl.controlId, 'ARL-KB-057');
  assert.equal(
    state.nextAllowedAction.name,
    'authorise_and_run_exact_retest'
  );
  assert.equal(
    state.nextAllowedAction.caseId,
    'RT-TOOL-004'
  );
});

test('legacy unbound retest recovery is fail-closed and audit-preserving', () => {
  const source = fs.readFileSync(
    new URL('../src/agent/git-remediation-handoff.mjs', import.meta.url),
    'utf8'
  );

  assert.match(
    source,
    /legacy_unbound_failed_retest_recovery/
  );
  assert.match(
    source,
    /control_intelligence\.legacy_unbound_retest_recovery/
  );
  assert.match(
    source,
    /failed_retest_already_revision_bound/
  );
  assert.match(
    source,
    /lifecycle_state='invalidated'/
  );
  assert.match(
    source,
    /SET lifecycle_state='active'/
  );
  assert.match(
    source,
    /historical failed exact retest was not bound to a target revision/
  );
});
