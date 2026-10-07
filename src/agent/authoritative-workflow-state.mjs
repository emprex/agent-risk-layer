import {
  prepareAuthoritativeAssessmentWorkflow
} from './tools/prepare-authoritative-assessment-workflow.mjs';

import {
  getDeploymentReadiness
} from './tools/get-deployment-readiness.mjs';

import {
  getAssessmentControlBinding
} from './assessment-control-bindings.mjs';

import {
  deriveControlExecutionPolicy
} from './control-execution-policy.mjs';

import {
  buildFullProfileEvidenceWorkQueue
} from './full-profile-evidence-work-queue.mjs';

export const AUTHORITATIVE_WORKFLOW_STATE_SCHEMA =
  'arl.agent.workflow-state.v1';

const CONTROL_STAGE_PRIORITY = Object.freeze({
  finding: 0,
  remediation: 1,
  retest: 2,
  approval: 3,
  evidence: 4,
  test: 5,
  applicability: 6,
  deployment_decision: 7
});

function planEntries(evidencePlan) {
  return [
    ...(Array.isArray(evidencePlan?.checks)
      ? evidencePlan.checks
      : []),
    ...(Array.isArray(evidencePlan?.manual)
      ? evidencePlan.manual
      : [])
  ];
}

function questionIdForPlanEntry(entry) {
  return (
    entry?.gap?.questionId ||
    entry?.questionId ||
    null
  );
}

function mapEvidencePlanControls(evidencePlan) {
  return planEntries(evidencePlan)
    .map((entry) => {
      const questionId = questionIdForPlanEntry(entry);
      const binding =
        questionId
          ? getAssessmentControlBinding(questionId)
          : null;

      return {
        planId: entry?.id || null,
        caseId: entry?.caseId || null,
        questionId,
        controlId:
          binding?.available
            ? binding.controlId
            : null,
        bindingAvailable:
          binding?.available === true
      };
    });
}

function selectScopedControlState(
  controlIntelligence,
  planMappings,
  readiness
) {
  if (!Array.isArray(controlIntelligence?.items)) {
    return null;
  }

  /*
   * The 108-control assessment is not limited to the historical Evidence Plan
   * mappings. Control Intelligence is authoritative for the full current
   * snapshot, so any control that has progressed beyond untouched
   * applicability must remain eligible for workflow continuation. Untouched
   * controls remain eligible after active scoped work is complete, allowing
   * deterministic canonical-order expansion of the same assessment.
   */
  const fullProfile =
    Number(readiness?.summary?.profileControls || 0) === 108;

  const fullProfilePriority = Object.freeze({
    finding: 0,
    remediation: 1,
    retest: 2,
    approval: 3,
    evidence: 4,
    applicability: 5,
    test: 6,
    deployment_decision: 7
  });

  const candidates =
    controlIntelligence.items
      .map((item) => ({
        ...item,
        workflowPriority:
          (fullProfile
            ? fullProfilePriority[item.currentStage]
            : CONTROL_STAGE_PRIORITY[item.currentStage]) ?? 99
      }))
      .sort((left, right) => {
        if (
          left.workflowPriority !==
          right.workflowPriority
        ) {
          return (
            left.workflowPriority -
            right.workflowPriority
          );
        }

        return String(left.controlId)
          .localeCompare(String(right.controlId));
      });

  return candidates[0] || null;
}

function planMappingForControl(
  controlId,
  planMappings
) {
  return planMappings.find(
    (item) => item.controlId === controlId
  ) || null;
}

function artifactProjection({
  preparation,
  controlIntelligence,
  readiness,
  planMappings
}) {
  const evidencePlan =
    preparation?.evidencePlan || null;

  return {
    frozenTarget: {
      available:
        Boolean(preparation?.target?.revision),
      repositoryPath:
        preparation?.target?.repositoryPath || null,
      revision:
        preparation?.target?.revision || null,
      inspectorBindingVerified:
        preparation?.inspectorBinding?.verified === true
    },

    assessmentContext: {
      available:
        preparation?.assessmentContext?.available === true,
      projectId:
        preparation?.assessmentContext?.projectId || null,
      systemSnapshotId:
        preparation?.assessmentContext?.systemSnapshotId || null,
      systemSnapshotStatus:
        preparation?.assessmentContext?.systemSnapshotStatus || null
    },

    authoritativeAssessment: {
      available:
        preparation?.authoritativeAssessment?.available === true,
      assessmentId:
        preparation?.authoritativeAssessment?.assessmentId ||
        preparation?.authoritativeAssessment?.id ||
        null
    },

    bindings: {
      targetContextVerified:
        preparation?.targetContextBinding?.verified === true,
      assessmentContextVerified:
        preparation?.assessmentContextBinding?.verified === true
    },

    evidencePlan: {
      available:
        evidencePlan?.available === true,
      state:
        evidencePlan?.state || null,
      boundedChecks:
        Array.isArray(evidencePlan?.checks)
          ? evidencePlan.checks.length
          : 0,
      manualItems:
        Array.isArray(evidencePlan?.manual)
          ? evidencePlan.manual.length
          : 0,
      mappedControls:
        planMappings
          .filter((item) => item.controlId)
          .map((item) => ({
            planId: item.planId,
            caseId: item.caseId,
            questionId: item.questionId,
            controlId: item.controlId
          }))
    },

    controlIntelligence: {
      available:
        Boolean(controlIntelligence?.systemSnapshot?.id),
      systemSnapshotId:
        controlIntelligence?.systemSnapshot?.id || null,
      relevantControls:
        Array.isArray(controlIntelligence?.items)
          ? controlIntelligence.items
              .filter((item) =>
                planMappings.some(
                  (mapping) =>
                    mapping.controlId === item.controlId
                )
              )
              .map((item) => ({
                controlId: item.controlId,
                currentStage: item.currentStage || null,
                chainStatus: item.chainStatus || null,
                deploymentImpact:
                  item.deploymentImpact || null,
                availableActions:
                  Array.isArray(item.availableActions)
                    ? item.availableActions
                    : []
              }))
          : []
    },

    readiness: {
      available:
        readiness?.available === true,
      decision:
        readiness?.decision || null,
      systemSnapshotId:
        readiness?.systemSnapshotId || null,
      humanReviewRequired: true
    }
  };
}

function action({
  name,
  actor,
  requiresUserInput,
  reason,
  controlId = null,
  caseId = null
}) {
  return {
    name,
    actor,
    requiresUserInput,
    reason,
    controlId,
    caseId
  };
}

function stateResult({
  stage,
  blockers = [],
  nextAllowedAction,
  preparation,
  controlIntelligence,
  readiness,
  planMappings,
  scopedControl = null,
  evidenceWorkQueue = null
}) {
  const requiresUserInput =
    nextAllowedAction?.requiresUserInput === true;

  const canAutoAdvance =
    nextAllowedAction?.actor === 'arl' &&
    requiresUserInput === false;

  return {
    type: 'authoritative_workflow_state',
    schema: AUTHORITATIVE_WORKFLOW_STATE_SCHEMA,
    available: true,
    stage,
    blocked:
      blockers.length > 0 ||
      requiresUserInput,
    canAutoAdvance,
    blockers,
    authoritativeArtifacts:
      artifactProjection({
        preparation,
        controlIntelligence,
        readiness,
        planMappings
      }),
    scopedControl:
      scopedControl
        ? {
            controlId:
              scopedControl.controlId || null,
            currentStage:
              scopedControl.currentStage || null,
            chainStatus:
              scopedControl.chainStatus || null,
            nextAction:
              scopedControl.nextAction || null,
            deploymentImpact:
              scopedControl.deploymentImpact || null,
            testMode:
              scopedControl.testMode || null,
            automationStatus:
              scopedControl.automationStatus || null
          }
        : null,
    nextAllowedAction,
    readiness,
    evidenceWorkQueue,
    deploymentDecisionWritten: false,
    humanReviewRequired: true
  };
}

function stateFromScopedControl({
  scopedControl,
  preparation,
  controlIntelligence,
  readiness,
  planMappings
}) {
  const mapping =
    planMappingForControl(
      scopedControl.controlId,
      planMappings
    );

  const common = {
    preparation,
    controlIntelligence,
    readiness,
    planMappings,
    scopedControl
  };

  if (scopedControl.currentStage === 'finding') {
    return stateResult({
      ...common,
      stage: 'finding_creation_required',
      nextAllowedAction: action({
        name: 'create_authoritative_finding',
        actor: 'arl',
        requiresUserInput: false,
        reason:
          scopedControl.nextAction ||
          'A persisted failed test with qualifying evidence requires an authoritative finding before the workflow can continue.',
        controlId: scopedControl.controlId,
        caseId: mapping?.caseId || null
      })
    });
  }

  if (scopedControl.currentStage === 'remediation') {
    const remediationState =
      scopedControl.remediationState || {};

    if (
      remediationState.implementationRecorded === true &&
      remediationState.remediatedSnapshotReady !== true
    ) {
      return stateResult({
        ...common,
        stage: 'changed_system_snapshot_required',
        blockers: [
          {
            code: 'changed_system_snapshot_required',
            source: 'control_intelligence',
            userActionRequired: true
          }
        ],
        nextAllowedAction: action({
          name: 'capture_changed_system_snapshot',
          actor: 'user',
          requiresUserInput: true,
          reason:
            scopedControl.nextAction ||
            'Implementation evidence exists, but an authoritative changed system snapshot is required before any retest.',
          controlId: scopedControl.controlId,
          caseId: mapping?.caseId || null
        })
      });
    }

    return stateResult({
      ...common,
      stage: 'remediation_required',
      blockers: [
        {
          code: 'remediation_implementation_evidence_required',
          source: 'control_intelligence',
          userActionRequired: true
        }
      ],
      nextAllowedAction: action({
        name: 'provide_remediation_implementation',
        actor: 'user',
        requiresUserInput: true,
        reason:
          scopedControl.nextAction ||
          'The authoritative finding remains open and requires remediation implementation evidence.',
        controlId: scopedControl.controlId,
        caseId: mapping?.caseId || null
      })
    });
  }

  if (scopedControl.currentStage === 'retest') {
    return stateResult({
      ...common,
      stage: 'exact_retest_required',
      blockers: [
        {
          code: 'exact_retest_required',
          source: 'control_intelligence',
          userActionRequired: true
        }
      ],
      nextAllowedAction: action({
        name: 'authorise_and_run_exact_retest',
        actor: 'user',
        requiresUserInput: true,
        reason:
          scopedControl.nextAction ||
          'The original failure must be retested with exact lineage against the changed snapshot.',
        controlId: scopedControl.controlId,
        caseId: mapping?.caseId || null
      })
    });
  }

  if (scopedControl.currentStage === 'approval') {
    return stateResult({
      ...common,
      stage: 'human_approval_required',
      blockers: [
        {
          code: 'human_approval_required',
          source: 'control_intelligence',
          userActionRequired: true
        }
      ],
      nextAllowedAction: action({
        name: 'record_required_human_approval',
        actor: 'human',
        requiresUserInput: true,
        reason:
          scopedControl.nextAction ||
          'Control Intelligence requires an accountable human approval event.',
        controlId: scopedControl.controlId,
        caseId: mapping?.caseId || null
      })
    });
  }

  if (scopedControl.currentStage === 'evidence') {
    return stateResult({
      ...common,
      stage: 'evidence_recording_required',
      nextAllowedAction: action({
        name: 'record_authoritative_evidence',
        actor: 'arl',
        requiresUserInput: false,
        reason:
          scopedControl.nextAction ||
          'ARL must bind qualifying evidence to the authoritative control state before the workflow can continue.',
        controlId: scopedControl.controlId,
        caseId: mapping?.caseId || null
      })
    });
  }

  if (scopedControl.currentStage === 'test') {
    const boundedCaseId = mapping?.caseId || null;
    const policy = deriveControlExecutionPolicy({
      currentStage: scopedControl.currentStage,
      caseId: boundedCaseId,
      testMode: scopedControl.testMode,
      automationStatus: scopedControl.automationStatus
    });

    if (
      scopedControl.chainStatus === 'test_inconclusive' ||
      policy.mode === 'manual_evidence'
    ) {
      return stateResult({
        ...common,
        stage: 'manual_evidence_required',
        blockers: [
          {
            code: 'manual_evidence_required',
            source: 'control_execution_policy',
            userActionRequired: true
          }
        ],
        nextAllowedAction: action({
          name: 'provide_required_manual_evidence',
          actor: 'user',
          requiresUserInput: true,
          reason:
            scopedControl.nextAction ||
            'This control is manual or has no verified automatic executor. Provide only the evidence that cannot be derived from the frozen target.',
          controlId: scopedControl.controlId,
          caseId: null
        })
      });
    }

    if (policy.mode === 'bounded_test') {
      return stateResult({
        ...common,
        stage: 'bounded_test_required',
        blockers: [
          {
            code: 'authorised_bounded_test_required',
            source: 'control_execution_policy',
            userActionRequired: true
          }
        ],
        nextAllowedAction: action({
          name: 'authorise_and_run_bounded_test',
          actor: 'user',
          requiresUserInput: true,
          reason:
            scopedControl.nextAction ||
            'This control requires an explicitly authorised bounded test.',
          controlId: scopedControl.controlId,
          caseId: boundedCaseId
        })
      });
    }

    return stateResult({
      ...common,
      stage: 'control_test_required',
      blockers: [],
      nextAllowedAction: action({
        name: 'run_authoritative_control_test',
        actor: 'arl',
        requiresUserInput: false,
        reason:
          scopedControl.nextAction ||
          'A verified automatic executor is available for this control.',
        controlId: scopedControl.controlId,
        caseId: null
      })
    });
  }

  if (scopedControl.currentStage === 'applicability') {
    const mapped = Boolean(mapping);
    return stateResult({
      ...common,
      stage: 'control_applicability_required',
      nextAllowedAction: action({
        name: 'resolve_control_applicability',
        actor: mapped ? 'arl' : 'user',
        requiresUserInput: !mapped,
        reason:
          scopedControl.nextAction ||
          'Control Intelligence must resolve applicability from authoritative project state before testing.',
        controlId: scopedControl.controlId,
        caseId: mapping?.caseId || null
      })
    });
  }

  if (scopedControl.currentStage === 'deployment_decision') {
    return stateResult({
      ...common,
      stage: 'readiness_review',
      blockers: [
        {
          code: 'human_final_decision_required',
          source: 'human_accountability',
          userActionRequired: true
        }
      ],
      nextAllowedAction: action({
        name: 'review_current_arl_readiness',
        actor: 'human',
        requiresUserInput: true,
        reason:
          'Control Intelligence readiness may be reviewed, but ARL does not write the final deployment decision.',
        controlId: scopedControl.controlId,
        caseId: mapping?.caseId || null
      })
    });
  }

  return null;
}

export function deriveAuthoritativeWorkflowState({
  projectId = null,
  userId = null,
  assessmentId = null,
  preparation = null,
  controlIntelligence = null,
  readiness = null,
  evidenceWorkQueue = null
} = {}) {
  const evidencePlan =
    preparation?.evidencePlan || null;

  const planMappings =
    mapEvidencePlanControls(evidencePlan);

  const common = {
    preparation,
    controlIntelligence,
    readiness,
    planMappings,
    evidenceWorkQueue
  };

  const missingIdentity = [
    ['projectId', projectId],
    ['userId', userId],
    ['assessmentId', assessmentId]
  ]
    .filter(([, value]) => !value)
    .map(([name]) => name);

  if (missingIdentity.length > 0) {
    return stateResult({
      ...common,
      stage: 'authoritative_identity_required',
      blockers: missingIdentity.map((name) => ({
        code: `${name}_required`,
        source: 'assessment_identity',
        userActionRequired: true
      })),
      nextAllowedAction: action({
        name: 'provide_authoritative_assessment_identity',
        actor: 'user',
        requiresUserInput: true,
        reason:
          `Missing authoritative identity: ${missingIdentity.join(', ')}.`
      })
    });
  }

  if (
    preparation?.assessmentContext?.available !== true
  ) {
    return stateResult({
      ...common,
      stage: 'assessment_context_required',
      blockers: [
        {
          code:
            preparation?.assessmentContext?.reason ||
            'authoritative_assessment_context_required',
          source: 'assessment_context',
          userActionRequired: true
        }
      ],
      nextAllowedAction: action({
        name: 'complete_authoritative_assessment_context',
        actor: 'user',
        requiresUserInput: true,
        reason:
          'ARL requires a persisted authoritative project snapshot before assessment orchestration can continue.'
      })
    });
  }

  if (
    preparation?.authoritativeAssessment?.available !== true
  ) {
    return stateResult({
      ...common,
      stage: 'authoritative_assessment_required',
      blockers: [
        {
          code:
            preparation?.authoritativeAssessment?.reason ||
            'authoritative_assessment_required',
          source: 'assessment',
          userActionRequired: true
        }
      ],
      nextAllowedAction: action({
        name: 'select_or_create_authoritative_assessment',
        actor: 'user',
        requiresUserInput: true,
        reason:
          'A persisted authoritative assessment is required before its evidence questions can be orchestrated.'
      })
    });
  }

  if (
    preparation?.targetContextBinding?.verified !== true
  ) {
    return stateResult({
      ...common,
      stage: 'target_context_binding_required',
      blockers: [
        {
          code:
            preparation?.targetContextBinding?.reason ||
            'target_context_binding_required',
          source: 'target_context_binding',
          userActionRequired: true
        }
      ],
      nextAllowedAction: action({
        name: 'bind_frozen_target_to_context',
        actor: 'user',
        requiresUserInput: true,
        reason:
          'The frozen repository revision must match the authoritative target binding before evidence can be used.'
      })
    });
  }

  if (
    preparation?.assessmentContextBinding?.verified !== true
  ) {
    return stateResult({
      ...common,
      stage: 'assessment_context_binding_required',
      blockers: [
        {
          code:
            preparation?.assessmentContextBinding?.reason ||
            'assessment_context_binding_required',
          source: 'assessment_context_binding',
          userActionRequired: true
        }
      ],
      nextAllowedAction: action({
        name: 'bind_assessment_to_snapshot',
        actor: 'user',
        requiresUserInput: true,
        reason:
          'The authoritative assessment must be explicitly bound to the active system snapshot.'
      })
    });
  }

  if (evidencePlan?.available !== true) {
    return stateResult({
      ...common,
      stage: 'evidence_plan_required',
      blockers: [
        {
          code:
            evidencePlan?.reason ||
            'authoritative_evidence_plan_required',
          source: 'evidence_plan',
          userActionRequired: false
        }
      ],
      nextAllowedAction: action({
        name: 'build_authoritative_evidence_plan',
        actor: 'arl',
        requiresUserInput: false,
        reason:
          'ARL must build the Evidence Plan from the authoritative assessment and frozen Inspector result.'
      })
    });
  }

  const scopedControl =
    selectScopedControlState(
      controlIntelligence,
      planMappings,
      readiness
    );

  if (scopedControl) {
    const scopedState =
      stateFromScopedControl({
        scopedControl,
        ...common
      });

    if (scopedState) {
      return scopedState;
    }
  }

  if (evidencePlan.state === 'bounded-check-required') {
    const firstCheck =
      evidencePlan.checks?.[0] || null;

    return stateResult({
      ...common,
      stage: 'bounded_test_required',
      blockers: [
        {
          code: 'authorised_bounded_test_required',
          source: 'evidence_plan',
          userActionRequired: true
        }
      ],
      nextAllowedAction: action({
        name: 'authorise_and_run_bounded_test',
        actor: 'user',
        requiresUserInput: true,
        reason:
          'The Evidence Plan requires a bounded runtime check. ARL must not substitute a generic attack or infer a result.',
        caseId: firstCheck?.caseId || null
      })
    });
  }

  if (evidencePlan.state === 'manual-evidence-required') {
    return stateResult({
      ...common,
      stage: 'manual_evidence_required',
      blockers: [
        {
          code: 'manual_evidence_required',
          source: 'evidence_plan',
          userActionRequired: true
        }
      ],
      nextAllowedAction: action({
        name: 'provide_required_manual_evidence',
        actor: 'user',
        requiresUserInput: true,
        reason:
          'The remaining evidence gaps are not mapped to a safe automatic bounded check and must remain open until qualifying evidence is provided.'
      })
    });
  }

  if (evidencePlan.state === 'source-required') {
    return stateResult({
      ...common,
      stage: 'source_evidence_required',
      nextAllowedAction: action({
        name: 'run_frozen_source_inspection',
        actor: 'arl',
        requiresUserInput: false,
        reason:
          'ARL requires source evidence before selecting runtime checks.'
      })
    });
  }

  return stateResult({
    ...common,
    stage: 'readiness_review',
    blockers: [
      {
        code: 'human_final_decision_required',
        source: 'human_accountability',
        userActionRequired: true
      }
    ],
    nextAllowedAction: action({
      name: 'review_current_arl_readiness',
      actor: 'human',
      requiresUserInput: true,
      reason:
        'The authoritative evidence workflow has no further automatically selected runtime check. Review current Control Intelligence readiness; the final deployment decision remains human.'
    })
  });
}

export async function getAuthoritativeWorkflowState({
  repositoryPath,
  projectId = null,
  userId = null,
  assessmentId = null
} = {}) {
  if (!repositoryPath) {
    throw new Error('repositoryPath is required');
  }

  const preparation =
    await prepareAuthoritativeAssessmentWorkflow({
      repositoryPath,
      projectId,
      userId,
      assessmentId
    });

  let controlIntelligence = null;
  let riskKnowledge = null;

  if (
    projectId &&
    userId &&
    preparation.assessmentContext?.available === true
  ) {
    const { getControlIntelligence } =
      await import('../control-intelligence.js');

    const firstPage =
      await getControlIntelligence({
        projectId,
        userId,
        limit: 50,
        offset: 0
      });

    const pages = [firstPage];

    for (
      let offset = firstPage.items?.length || 0;
      firstPage.hasMore === true && offset < (firstPage.total || 0);
      offset += 50
    ) {
      pages.push(
        await getControlIntelligence({
          projectId,
          userId,
          limit: 50,
          offset
        })
      );

      const latest = pages.at(-1);
      if (latest?.hasMore !== true) break;
    }

    controlIntelligence = {
      ...firstPage,
      items: pages.flatMap((page) =>
        Array.isArray(page?.items) ? page.items : []
      ),
      limit: pages.reduce(
        (count, page) => count + (page?.items?.length || 0),
        0
      ),
      offset: 0,
      hasMore: false
    };

    const { listRiskKnowledge } =
      await import('../risk-knowledge.js');

    riskKnowledge =
      await listRiskKnowledge({
        limit: 250,
        offset: 0
      });

    const metadataByControl =
      new Map(
        (riskKnowledge?.items || []).map((item) => [
          item.id,
          {
            testMode:
              item?.operationalMetadata?.testMode || null,
            automationStatus:
              item?.operationalMetadata?.automationStatus || null
          }
        ])
      );

    controlIntelligence = {
      ...controlIntelligence,
      items:
        (controlIntelligence?.items || []).map((item) => ({
          ...item,
          ...(metadataByControl.get(item.controlId) || {})
        }))
    };
  }

  const readiness =
    await getDeploymentReadiness({
      projectId,
      userId
    });

  const evidenceWorkQueue =
    buildFullProfileEvidenceWorkQueue({
      controlIntelligence,
      riskKnowledge,
      readiness
    });

  return deriveAuthoritativeWorkflowState({
    projectId,
    userId,
    assessmentId,
    preparation,
    controlIntelligence,
    readiness,
    evidenceWorkQueue
  });
}
