import test from 'node:test';
import assert from 'node:assert/strict';

import {
  buildCanonicalEvidenceRequirementPlan
} from '../src/agent/canonical-evidence-requirement-plan.mjs';

import {
  buildFullProfileEvidenceWorkQueue
} from '../src/agent/full-profile-evidence-work-queue.mjs';

import {
  deriveAuthoritativeWorkflowState
} from '../src/agent/authoritative-workflow-state.mjs';

function knowledge() {
  return {
    items: [
      {
        id: 'ARL-KB-004',
        title: 'Risk classification does not match real impact',
        category: 'Governance and scope',
        claimsBoundary: 'Observed evidence only.',
        checks: [
          {
            objective: 'Verify risk classification.',
            method: 'Inspect the exact assessed version.',
            requiredEvidence: [
              'ARL-KB-004 exact assessed system, version, environment, scope and declared risk tier',
              'ARL-KB-004 accountable human reviewer identity, role, timestamp, decision and evidence digest'
            ],
            passCondition: 'Version-bound evidence and accountable review support the declared tier.',
            failCondition: 'The declared tier is unsupported.'
          }
        ]
      }
    ]
  };
}

function readiness() {
  return {
    available: true,
    decision: 'hold',
    systemSnapshotId: 'sys_current',
    summary: {
      profileControls: 108,
      applicableControls: 105,
      controlsMissingEvidence: 101
    }
  };
}

function preparation() {
  return {
    target: {
      revision: 'b3116fcfcec3bf6967773c3e9587c502b1fed5e5'
    },
    inspectorBinding: { verified: true },
    assessmentContext: {
      available: true,
      projectId: 'prj_test',
      systemSnapshotId: 'sys_current',
      systemSnapshotStatus: 'current'
    },
    authoritativeAssessment: {
      available: true,
      assessmentId: 'asm_test'
    },
    targetContextBinding: { verified: true },
    assessmentContextBinding: { verified: true },
    evidencePlan: {
      available: true,
      state: 'manual-evidence-required',
      checks: [],
      manual: []
    }
  };
}

function control(authoritativeDetail = null) {
  return {
    controlId: 'ARL-KB-004',
    currentStage: 'test',
    chainStatus: 'applicable_unassessed',
    nextAction: 'Record or run a test.',
    deploymentImpact: 'hold',
    testMode: 'manual',
    automationStatus: 'unsupported',
    authoritativeDetail
  };
}

test('canonical evidence planning separates frozen observations from accountable human review', () => {
  const plan = buildCanonicalEvidenceRequirementPlan([
    'ARL-KB-004 exact assessed system, version, environment, scope and declared risk tier',
    'ARL-KB-004 accountable human reviewer identity, role, timestamp, decision and evidence digest',
    'ARL-KB-012 bounded negative evidence showing an experimental identity cannot reach production-equivalent data'
  ]);

  assert.deepEqual(
    plan.map((item) => item.mode),
    [
      'machine_collectable',
      'human_only',
      'active_test_or_runtime'
    ]
  );
});

test('manual controls collect deterministic frozen evidence before human review', () => {
  const queue =
    buildFullProfileEvidenceWorkQueue({
      controlIntelligence: {
        items: [control()]
      },
      riskKnowledge: knowledge(),
      readiness: readiness()
    });

  assert.equal(
    queue.items[0].classification,
    'machine_observable'
  );
  assert.deepEqual(
    queue.items[0].machineCollectableRequirements,
    [
      'ARL-KB-004 exact assessed system, version, environment, scope and declared risk tier'
    ]
  );

  const state =
    deriveAuthoritativeWorkflowState({
      projectId: 'prj_test',
      userId: 'usr_test',
      assessmentId: 'asm_test',
      preparation: preparation(),
      controlIntelligence: {
        systemSnapshot: { id: 'sys_current' },
        items: [control()]
      },
      readiness: readiness(),
      evidenceWorkQueue: queue
    });

  assert.equal(
    state.stage,
    'control_evidence_collection_required'
  );
  assert.equal(
    state.nextAllowedAction.name,
    'collect_authoritative_control_evidence'
  );
  assert.equal(state.nextAllowedAction.actor, 'arl');
  assert.equal(
    state.nextAllowedAction.requiresUserInput,
    false
  );
});

test('once frozen evidence is already recorded the same control falls back to accountable review instead of looping', () => {
  const queue =
    buildFullProfileEvidenceWorkQueue({
      controlIntelligence: {
        items: [
          control({
            evidence: [
              {
                sourceType:
                  'arl_frozen_source_evidence_collection'
              }
            ]
          })
        ]
      },
      riskKnowledge: knowledge(),
      readiness: readiness()
    });

  assert.equal(
    queue.items[0].automaticEvidenceCollected,
    true
  );
  assert.equal(
    queue.items[0].classification,
    'human_only'
  );
});


test('inconclusive post-collection manual control exposes the canonical evidence checklist instead of an empty user gate', () => {
  const collected = control({
    evidence: [
      {
        sourceType:
          'arl_frozen_source_evidence_collection'
      }
    ]
  });

  collected.chainStatus = 'test_inconclusive';
  collected.nextAction =
    'Resolve the inconclusive test with additional evidence or rerun it.';

  const queue =
    buildFullProfileEvidenceWorkQueue({
      controlIntelligence: {
        items: [collected]
      },
      riskKnowledge: knowledge(),
      readiness: readiness()
    });

  assert.equal(
    queue.items[0].classification,
    'human_only'
  );

  const state =
    deriveAuthoritativeWorkflowState({
      projectId: 'prj_test',
      userId: 'usr_test',
      assessmentId: 'asm_test',
      preparation: preparation(),
      controlIntelligence: {
        systemSnapshot: { id: 'sys_current' },
        items: [collected]
      },
      readiness: readiness(),
      evidenceWorkQueue: queue
    });

  assert.equal(
    state.stage,
    'manual_evidence_required'
  );
  assert.equal(
    state.nextAllowedAction.name,
    'provide_required_manual_evidence'
  );
  assert.deepEqual(
    state.nextAllowedAction.requirements,
    knowledge().items[0].checks[0].requiredEvidence
  );
  assert.ok(
    state.humanEvidenceBatch
      .requirements.length > 0
  );
});

test('post-collection runtime evidence is routed to an explicit active-test gate instead of generic inconclusive', () => {
  const activeKnowledge = knowledge();
  activeKnowledge.items[0].checks[0].requiredEvidence.push(
    'ARL-KB-004 bounded negative evidence showing an unapproved action is denied before side effects'
  );

  const collected = control({
    evidence: [
      {
        sourceType:
          'arl_frozen_source_evidence_collection'
      }
    ]
  });

  collected.chainStatus = 'test_inconclusive';
  collected.testMode = 'hybrid';
  collected.automationStatus = 'candidate';

  const queue =
    buildFullProfileEvidenceWorkQueue({
      controlIntelligence: {
        items: [collected]
      },
      riskKnowledge: activeKnowledge,
      readiness: readiness()
    });

  assert.equal(
    queue.items[0].classification,
    'active_test_required'
  );
  assert.equal(
    queue.summary.activeTestRequired,
    1
  );
  assert.equal(
    queue.summary.unavailableOrInconclusive,
    0
  );

  const state =
    deriveAuthoritativeWorkflowState({
      projectId: 'prj_test',
      userId: 'usr_test',
      assessmentId: 'asm_test',
      preparation: preparation(),
      controlIntelligence: {
        systemSnapshot: { id: 'sys_current' },
        items: [collected]
      },
      readiness: readiness(),
      evidenceWorkQueue: queue
    });

  assert.equal(
    state.stage,
    'active_test_plan_required'
  );
  assert.equal(
    state.nextAllowedAction.name,
    'define_and_authorise_control_test'
  );
  assert.equal(
    state.nextAllowedAction.actor,
    'human'
  );
  assert.equal(
    state.nextAllowedAction.requiresUserInput,
    true
  );
  assert.equal(
    state.nextAllowedAction.requirements.length,
    1
  );
});
