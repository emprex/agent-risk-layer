import {
  publicHostedOperatorContextError,
  resolveHostedOperatorContext
} from './hosted-operator-context.mjs';
import {
  resolveHostedAssessmentPreparation
} from './hosted-assessment-preparation.mjs';
import {
  ensureInitialAssessmentSnapshot
} from './initial-assessment-snapshot.mjs';
import {
  getHostedDeclaredAssessmentContextStatus,
  recordHostedDeclaredAssessmentContext
} from './hosted-assessment-context.mjs';
import {
  confirmHostedMappedControlApplicability
} from './hosted-applicability-confirmation.mjs';
import {
  buildHostedPreparationConversation
} from './hosted-workflow-conversation.mjs';
import {
  persistBoundedRedTeamReservation,
  prepareBoundedRedTeamReservation
} from './bounded-redteam-handoff.mjs';
import {
  executeGatedWorkflow
} from './gated-workflow-executor.mjs';
import {
  executeAuthoritativeArlAction
} from './authoritative-auto-actions.mjs';
import {
  prepareHostedRemediationHandoff,
  completeHostedRemediationHandoff
} from './hosted-remediation-handoff.mjs';
import {
  captureChangedSystemSnapshotFromFrozenInspection
} from './changed-system-snapshot-handoff.mjs';
import {
  recordRemediationApplicabilityConfirmationFromCurrentSnapshot
} from './remediation-applicability-handoff.mjs';
import {
  prepareExactRetestRedTeamReservation,
  persistExactRetestRedTeamReservation
} from './exact-retest-redteam-handoff.mjs';

export const HOSTED_AGENT_PREPARATION_PATH =
  '/api/agent/assessment/prepare';
export const HOSTED_AGENT_CONTEXT_PATH =
  '/api/agent/assessment/context';
export const HOSTED_AGENT_APPLICABILITY_PATH =
  '/api/agent/assessment/applicability';
export const HOSTED_AGENT_BOUNDED_TEST_PREPARE_PATH =
  '/api/agent/assessment/bounded-test/prepare';
export const HOSTED_AGENT_BOUNDED_TEST_COMPLETE_PATH =
  '/api/agent/assessment/bounded-test/complete';
export const HOSTED_AGENT_CONTINUE_PATH =
  '/api/agent/assessment/continue';
export const HOSTED_AGENT_REMEDIATION_PREPARE_PATH =
  '/api/agent/assessment/remediation/prepare';
export const HOSTED_AGENT_REMEDIATION_COMPLETE_PATH =
  '/api/agent/assessment/remediation/complete';
export const HOSTED_AGENT_CHANGED_SNAPSHOT_PATH =
  '/api/agent/assessment/changed-snapshot';
export const HOSTED_AGENT_REMEDIATION_APPLICABILITY_PATH =
  '/api/agent/assessment/remediation/applicability';
export const HOSTED_AGENT_EXACT_RETEST_PREPARE_PATH =
  '/api/agent/assessment/exact-retest/prepare';

export const HOSTED_AGENT_EXACT_RETEST_COMPLETE_PATH =
  '/api/agent/assessment/exact-retest/complete';

function statusForError(error) {
  if (
    Number.isInteger(error?.statusCode) &&
    error.statusCode >= 400 &&
    error.statusCode <= 599
  ) {
    return error.statusCode;
  }

  switch (error?.code) {
    case 'HOSTED_OPERATOR_AUTHENTICATION_REQUIRED':
    case 'OPERATOR_AUTHENTICATION_REQUIRED':
      return 401;
    case 'OPERATOR_EMAIL_VERIFICATION_REQUIRED':
    case 'OPERATOR_MFA_VERIFICATION_REQUIRED':
      return 403;
    case 'WORKSPACE_RESOLUTION_REQUIRED':
    case 'WORKSPACE_NAMES_NOT_UNIQUE':
    case 'REPOSITORY_CONTEXT_AMBIGUOUS':
    case 'PROJECT_ASSESSMENT_BINDING_CONFLICT':
      return 409;
    default:
      return 400;
  }
}

function publicError(error) {
  const operatorError = publicHostedOperatorContextError(error);
  return {
    ...operatorError,
    deploymentDecisionWritten: false,
    humanReviewRequired: true
  };
}

function apiConflict(code, message) {
  const error = new Error(message);
  error.code = code;
  error.statusCode = 409;
  return error;
}

async function resolveHostedWorkflow({ operator, body = {}, command = 'continue' } = {}) {
  const operatorResolution = await resolveHostedOperatorContext({
    operator,
    body
  });
  const declaredContext =
    await getHostedDeclaredAssessmentContextStatus({
      operatorContextInternal: operatorResolution.internal
    });
  if (declaredContext.confirmed !== true) {
    throw apiConflict(
      'HOSTED_ASSESSMENT_CONTEXT_REQUIRED',
      'Customer-declared agent context must be confirmed before this authoritative workflow action can run.'
    );
  }

  const preparationResolution = await resolveHostedAssessmentPreparation({
    operatorContextInternal: operatorResolution.internal,
    body: {
      frozenInspection: body.frozenInspection
    }
  });
  const conversation = await buildHostedPreparationConversation({
    operatorContextInternal: operatorResolution.internal,
    preparation: preparationResolution.internal,
    command
  });

  return {
    operatorResolution,
    declaredContext,
    preparationResolution,
    conversation
  };
}

export async function prepareHostedAgentAssessment({
  operator,
  body = {}
} = {}) {
  const operatorResolution = await resolveHostedOperatorContext({
    operator,
    body: {
      repositoryIdentity: body.repositoryIdentity,
      workspaceName: body.workspaceName,
      environment: body.environment
    }
  });

  const initialSnapshot = await ensureInitialAssessmentSnapshot({
    operatorContextInternal: operatorResolution.internal,
    frozenInspection: body.frozenInspection
  });

  const declaredContext =
    await getHostedDeclaredAssessmentContextStatus({
      operatorContextInternal: operatorResolution.internal
    });

  const preparationResolution = await resolveHostedAssessmentPreparation({
    operatorContextInternal: operatorResolution.internal,
    body: {
      frozenInspection: body.frozenInspection
    }
  });

  const conversation = await buildHostedPreparationConversation({
    operatorContextInternal: operatorResolution.internal,
    preparation: preparationResolution.internal,
    command: 'assess'
  });

  return {
    statusCode:
      operatorResolution.statusCode === 201 || initialSnapshot.created === true
        ? 201
        : 200,
    body: {
      operatorContext: operatorResolution.body.operatorContext,
      initialSnapshot,
      declaredContext,
      preparation: preparationResolution.body.preparation,
      conversationResponse: conversation.conversationResponse,
      securityStateChanged:
        operatorResolution.securityStateChanged === true ||
        initialSnapshot.created === true,
      securityDecisionCreated: false,
      deploymentDecisionWritten: false,
      humanReviewRequired: true
    },
    internal: {
      operatorContext: operatorResolution.internal,
      initialSnapshot,
      declaredContext,
      preparation: preparationResolution.internal,
      workflowState: conversation.internal.workflowState
    }
  };
}

export async function updateHostedAgentAssessmentContext({
  operator,
  body = {}
} = {}) {
  const operatorResolution = await resolveHostedOperatorContext({
    operator,
    body
  });

  const context = await recordHostedDeclaredAssessmentContext({
    operatorContextInternal: operatorResolution.internal,
    frozenInspection: body.frozenInspection,
    declaredContext: body.declaredContext,
    environment: body.environment
  });

  const preparationResolution = await resolveHostedAssessmentPreparation({
    operatorContextInternal: operatorResolution.internal,
    body: {
      frozenInspection: body.frozenInspection
    }
  });

  const conversation = await buildHostedPreparationConversation({
    operatorContextInternal: operatorResolution.internal,
    preparation: preparationResolution.internal,
    command: 'continue'
  });

  return {
    statusCode: 200,
    body: {
      operatorContext: operatorResolution.body.operatorContext,
      declaredContext: context,
      preparation: preparationResolution.body.preparation,
      conversationResponse: conversation.conversationResponse,
      securityStateChanged:
        operatorResolution.securityStateChanged === true ||
        context.securityStateChanged === true,
      securityDecisionCreated: false,
      deploymentDecisionWritten: false,
      humanReviewRequired: true
    },
    internal: {
      operatorContext: operatorResolution.internal,
      declaredContext: context,
      preparation: preparationResolution.internal,
      workflowState: conversation.internal.workflowState
    }
  };
}

export async function confirmHostedAgentApplicability({
  operator,
  body = {}
} = {}) {
  const current = await resolveHostedWorkflow({ operator, body });
  const applicability = await confirmHostedMappedControlApplicability({
    workflowState: current.conversation.internal.workflowState,
    projectId: current.operatorResolution.internal.projectId,
    userId: current.operatorResolution.internal.userId,
    controlId: body.controlId,
    decision: body.decision,
    reason: body.reason,
    architectureFactIds: body.architectureFactIds
  });
  if (applicability.available !== true) {
    throw apiConflict(
      'HOSTED_APPLICABILITY_CONFIRMATION_BLOCKED',
      `ARL cannot record this applicability confirmation: ${applicability.reason}.`
    );
  }

  const reloadedPreparation = await resolveHostedAssessmentPreparation({
    operatorContextInternal: current.operatorResolution.internal,
    body: {
      frozenInspection: body.frozenInspection
    }
  });
  const conversation = await buildHostedPreparationConversation({
    operatorContextInternal: current.operatorResolution.internal,
    preparation: reloadedPreparation.internal,
    command: 'continue'
  });

  return {
    statusCode: 200,
    body: {
      operatorContext: current.operatorResolution.body.operatorContext,
      declaredContext: current.declaredContext,
      applicabilityConfirmation: applicability,
      preparation: reloadedPreparation.body.preparation,
      conversationResponse: conversation.conversationResponse,
      securityStateChanged: applicability.securityStateChanged === true,
      securityDecisionCreated: false,
      deploymentDecisionWritten: false,
      humanReviewRequired: true
    },
    internal: {
      operatorContext: current.operatorResolution.internal,
      declaredContext: current.declaredContext,
      applicabilityConfirmation: applicability,
      preparation: reloadedPreparation.internal,
      workflowState: conversation.internal.workflowState
    }
  };
}

export async function prepareHostedAgentBoundedTest({
  operator,
  body = {}
} = {}) {
  const current = await resolveHostedWorkflow({ operator, body });
  const reservation = await prepareBoundedRedTeamReservation({
    workflowState: current.conversation.internal.workflowState,
    projectId: current.operatorResolution.internal.projectId,
    userId: current.operatorResolution.internal.userId,
    assessmentId: current.operatorResolution.internal.assessmentId
  });
  if (reservation.available !== true) {
    throw apiConflict(
      'HOSTED_BOUNDED_TEST_PREPARATION_BLOCKED',
      `ARL cannot prepare this bounded test: ${reservation.reason}.`
    );
  }

  return {
    statusCode: 200,
    body: {
      operatorContext: current.operatorResolution.body.operatorContext,
      declaredContext: current.declaredContext,
      preparation: current.preparationResolution.body.preparation,
      conversationResponse: current.conversation.conversationResponse,
      boundedTestReservation: {
        available: true,
        status: reservation.status,
        reservationToken: reservation.reservationToken,
        expiresAt: reservation.expiresAt,
        executionPlan: reservation.executionPlan,
        deploymentDecisionWritten: false,
        humanReviewRequired: true
      },
      securityStateChanged: false,
      securityDecisionCreated: false,
      deploymentDecisionWritten: false,
      humanReviewRequired: true
    },
    internal: {
      operatorContext: current.operatorResolution.internal,
      workflowState: current.conversation.internal.workflowState
    }
  };
}

export async function completeHostedAgentBoundedTest({
  operator,
  body = {}
} = {}) {
  const current = await resolveHostedWorkflow({
    operator,
    body
  });

  const reservationToken =
    String(body.reservationToken || '').trim();

  if (!reservationToken || !body.bundle) {
    throw apiConflict(
      'HOSTED_BOUNDED_TEST_RESULT_REQUIRED',
      'A one-time bounded-test reservation and signed result bundle are required.'
    );
  }

  const persisted =
    await persistBoundedRedTeamReservation({
      reservationToken,
      bundle: body.bundle
    });

  if (persisted.available !== true) {
    throw apiConflict(
      'HOSTED_BOUNDED_TEST_PERSISTENCE_BLOCKED',
      `ARL cannot persist this bounded test result: ${persisted.reason}.`
    );
  }

  /*
   * Persistence satisfies only the user-operated bounded-test gate.
   * From here ARL may execute only its existing automatic authoritative
   * actions. The gated executor stops again at the next user/human gate.
   * No deployment decision can be written here.
   */
  const continued =
    await continueHostedAgentAssessment({
      operator,
      body
    });

  return {
    statusCode: 200,

    body: {
      operatorContext:
        continued.body.operatorContext,

      declaredContext:
        continued.body.declaredContext ||
        current.declaredContext,

      boundedTestResult:
        persisted,

      preparation:
        continued.body.preparation,

      conversationResponse:
        continued.body.conversationResponse,

      workflowExecution:
        continued.body.workflowExecution,

      securityStateChanged:
        persisted.securityStateChanged === true ||
        continued.body.securityStateChanged === true,

      securityDecisionCreated: false,
      deploymentDecisionWritten: false,
      humanReviewRequired: true
    },

    internal: {
      operatorContext:
        continued.internal.operatorContext,

      boundedTestResult:
        persisted,

      preparation:
        continued.internal.preparation,

      workflowExecution:
        continued.internal.workflowExecution,

      workflowState:
        continued.internal.workflowState
    }
  };
}

export async function prepareHostedAgentRemediation({
  operator,
  body = {}
} = {}) {
  const current = await resolveHostedWorkflow({
    operator,
    body,
    command: 'continue'
  });

  const remediation =
    await prepareHostedRemediationHandoff({
      workflowState:
        current.conversation.internal.workflowState
    });

  if (remediation.available !== true) {
    throw apiConflict(
      'HOSTED_REMEDIATION_PREPARATION_BLOCKED',
      `ARL cannot prepare remediation verification: ${remediation.reason}.`
    );
  }

  return {
    statusCode: 200,
    body: {
      operatorContext:
        current.operatorResolution.body.operatorContext,
      remediation,
      securityStateChanged: false,
      securityDecisionCreated: false,
      deploymentDecisionWritten: false,
      humanReviewRequired: true
    },
    internal: {
      operatorContext:
        current.operatorResolution.internal,
      workflowState:
        current.conversation.internal.workflowState
    }
  };
}

export async function completeHostedAgentRemediation({
  operator,
  body = {}
} = {}) {
  const current = await resolveHostedWorkflow({
    operator,
    body,
    command: 'continue'
  });

  const operatorContext =
    current.operatorResolution.internal;

  const remediation =
    await completeHostedRemediationHandoff({
      workflowState:
        current.conversation.internal.workflowState,
      projectId: operatorContext.projectId,
      userId: operatorContext.userId,
      frozenInspection:
        body.remediationFrozenInspection
    });

  if (remediation.available !== true) {
    throw apiConflict(
      'HOSTED_REMEDIATION_COMPLETION_BLOCKED',
      `ARL cannot record remediation implementation evidence: ${remediation.reason}.`
    );
  }

  const refreshed = await resolveHostedWorkflow({
    operator,
    body,
    command: 'continue'
  });

  return {
    statusCode: 200,
    body: {
      operatorContext:
        refreshed.operatorResolution.body.operatorContext,
      remediation: {
        type: remediation.type,
        schema: remediation.schema,
        available: remediation.available,
        status: remediation.status,
        controlId: remediation.controlId,
        baselineRevision:
          remediation.baselineRevision,
        currentRevision:
          remediation.currentRevision,
        nextStage: remediation.nextStage,
        securityStateChanged:
          remediation.securityStateChanged,
        deploymentDecisionWritten: false,
        humanReviewRequired: true
      },
      workflow:
        refreshed.conversation.body.workflow,
      securityStateChanged:
        remediation.securityStateChanged,
      securityDecisionCreated: false,
      deploymentDecisionWritten: false,
      humanReviewRequired: true
    },
    internal: {
      operatorContext:
        refreshed.operatorResolution.internal,
      workflowState:
        refreshed.conversation.internal.workflowState,
      remediation: remediation.internal || null
    }
  };
}

export async function captureHostedAgentChangedSnapshot({
  operator,
  body = {}
} = {}) {
  const current =
    await resolveHostedWorkflow({
      operator,
      body: {
        ...body,
        frozenInspection:
          body.frozenInspection
      },
      command: 'continue'
    });

  const operatorContext =
    current.operatorResolution.internal;

  const snapshot =
    await captureChangedSystemSnapshotFromFrozenInspection({
      frozenInspection:
        body.remediationFrozenInspection,
      projectId:
        operatorContext.projectId,
      userId:
        operatorContext.userId,
      assessmentId:
        operatorContext.assessmentId,
      confirmArchitectureUnchanged:
        body.confirmArchitectureUnchanged === true
    });

  if (snapshot.available !== true) {
    throw apiConflict(
      'HOSTED_CHANGED_SNAPSHOT_BLOCKED',
      `ARL cannot record the changed system snapshot: ${snapshot.reason}.`
    );
  }

  return {
    statusCode: 200,
    body: {
      operatorContext:
        current.operatorResolution.body.operatorContext,
      changedSnapshot: {
        type: snapshot.type,
        schema: snapshot.schema,
        available: true,
        status: snapshot.status,
        reason: snapshot.reason,
        snapshotCreated:
          snapshot.snapshotCreated,
        previousRevision:
          snapshot.previousRevision,
        currentRevision:
          snapshot.currentRevision,
        controlId:
          snapshot.controlId,
        securityStateChanged:
          snapshot.securityStateChanged,
        deploymentDecisionWritten: false,
        humanReviewRequired: true
      },
      securityStateChanged:
        snapshot.securityStateChanged,
      securityDecisionCreated: false,
      deploymentDecisionWritten: false,
      humanReviewRequired: true
    },
    internal: {
      operatorContext,
      changedSnapshot:
        snapshot.internal || null
    }
  };
}

export async function confirmHostedAgentRemediationApplicability({
  operator,
  body = {}
} = {}) {
  const current =
    await resolveHostedWorkflow({
      operator,
      body,
      command: 'continue'
    });

  const operatorContext =
    current.operatorResolution.internal;

  const applicability =
    await recordRemediationApplicabilityConfirmationFromCurrentSnapshot({
      projectId:
        operatorContext.projectId,
      userId:
        operatorContext.userId,
      assessmentId:
        operatorContext.assessmentId
    });

  if (applicability.available !== true) {
    throw apiConflict(
      'HOSTED_REMEDIATION_APPLICABILITY_BLOCKED',
      `ARL cannot record fresh remediation applicability: ${applicability.reason}.`
    );
  }

  const refreshed =
    await resolveHostedWorkflow({
      operator,
      body,
      command: 'continue'
    });

  return {
    statusCode: 200,
    body: {
      operatorContext:
        refreshed.operatorResolution.body.operatorContext,
      applicability: {
        type: applicability.type,
        schema: applicability.schema,
        available: true,
        status: applicability.status,
        reason: applicability.reason,
        controlId: applicability.controlId,
        applicabilityDecision:
          applicability.applicabilityDecision ||
          'applicable',
        securityStateChanged:
          applicability.securityStateChanged,
        deploymentDecisionWritten: false,
        humanReviewRequired: true
      },
      workflow:
        refreshed.conversation.body.workflow,
      securityStateChanged:
        applicability.securityStateChanged,
      securityDecisionCreated: false,
      deploymentDecisionWritten: false,
      humanReviewRequired: true
    },
    internal: {
      operatorContext:
        refreshed.operatorResolution.internal,
      workflowState:
        refreshed.conversation.internal.workflowState,
      applicability:
        applicability.internal || null
    }
  };
}

export async function prepareHostedAgentExactRetest({
  operator,
  body = {}
} = {}) {
  const current =
    await resolveHostedWorkflow({
      operator,
      body,
      command: 'continue'
    });

  const operatorContext =
    current.operatorResolution.internal;

  const workflowState =
    current.conversation.internal.workflowState;

  const reservation =
    await prepareExactRetestRedTeamReservation({
      workflowState,
      projectId:
        operatorContext.projectId,
      userId:
        operatorContext.userId,
      assessmentId:
        operatorContext.assessmentId
    });

  if (reservation.available !== true) {
    throw apiConflict(
      'HOSTED_EXACT_RETEST_PREPARE_BLOCKED',
      `ARL cannot prepare the exact retest: ${reservation.reason}.`
    );
  }

  return {
    statusCode: 200,
    body: {
      operatorContext:
        current.operatorResolution.body.operatorContext,
      exactRetest: {
        available: true,
        status:
          reservation.status,
        reason:
          reservation.reason,
        reservationToken:
          reservation.reservationToken,
        expiresAt:
          reservation.expiresAt,
        executionPlan:
          reservation.executionPlan,
        securityStateChanged: false,
        deploymentDecisionWritten: false,
        humanReviewRequired: true
      },
      securityStateChanged: false,
      securityDecisionCreated: false,
      deploymentDecisionWritten: false,
      humanReviewRequired: true
    },
    internal: {
      operatorContext,
      continuationContext:
        reservation.continuationContext
    }
  };
}

export async function completeHostedAgentExactRetest({
  operator,
  body = {}
} = {}) {
  const current =
    await resolveHostedWorkflow({
      operator,
      body,
      command: 'continue'
    });

  const operatorContext =
    current.operatorResolution.internal;

  const workflowState =
    current.conversation.internal.workflowState;

  const authority =
    await prepareExactRetestRedTeamReservation({
      workflowState,
      projectId:
        operatorContext.projectId,
      userId:
        operatorContext.userId,
      assessmentId:
        operatorContext.assessmentId
    });

  if (authority.available !== true) {
    throw apiConflict(
      'HOSTED_EXACT_RETEST_AUTHORITY_BLOCKED',
      `ARL cannot resolve exact retest authority: ${authority.reason}.`
    );
  }

  const persisted =
    await persistExactRetestRedTeamReservation({
      reservationToken:
        body.reservationToken,
      bundle:
        body.bundle,
      continuationContext:
        authority.continuationContext
    });

  if (persisted.available !== true) {
    throw apiConflict(
      'HOSTED_EXACT_RETEST_COMPLETE_BLOCKED',
      `ARL cannot complete the exact retest: ${persisted.reason}.`
    );
  }

  const refreshed =
    await resolveHostedWorkflow({
      operator,
      body,
      command: 'continue'
    });

  return {
    statusCode: 200,
    body: {
      operatorContext:
        refreshed.operatorResolution.body.operatorContext,
      exactRetest: {
        type:
          persisted.type,
        schema:
          persisted.schema,
        available: true,
        status:
          persisted.status,
        reason:
          persisted.reason,
        exactRetestReady:
          persisted.exactRetestReady === true,
        continuation:
          persisted.continuation || null,
        securityStateChanged:
          persisted.securityStateChanged,
        deploymentDecisionWritten: false,
        humanReviewRequired: true
      },
      workflow:
        refreshed.conversation.body.workflow,
      securityStateChanged:
        persisted.securityStateChanged,
      securityDecisionCreated: false,
      deploymentDecisionWritten: false,
      humanReviewRequired: true
    },
    internal: {
      operatorContext:
        refreshed.operatorResolution.internal,
      workflowState:
        refreshed.conversation.internal.workflowState
    }
  };
}

export async function continueHostedAgentAssessment({
  operator,
  body = {}
} = {}) {
  let current = await resolveHostedWorkflow({
    operator,
    body,
    command: 'continue'
  });

  const operatorContext =
    current.operatorResolution.internal;

  const hostedAutomaticActions = new Set([
    'record_authoritative_evidence',
    'create_authoritative_finding'
  ]);

  const execution = await executeGatedWorkflow({
    initialState:
      current.conversation.internal.workflowState,

    loadState: async () => {
      current = await resolveHostedWorkflow({
        operator,
        body,
        command: 'continue'
      });

      return current.conversation.internal.workflowState;
    },

    executeAction: async ({ action }) => {
      if (!hostedAutomaticActions.has(action?.name)) {
        return {
          executed: false,
          reason: 'hosted_automatic_arl_action_not_supported',
          securityStateChanged: false,
          deploymentDecisionWritten: false,
          humanReviewRequired: true
        };
      }

      return executeAuthoritativeArlAction({
        action,
        projectId: operatorContext.projectId,
        userId: operatorContext.userId,
        assessmentId: operatorContext.assessmentId,
        preparation:
          current.preparationResolution.internal
      });
    }
  });

  const reloaded = await resolveHostedWorkflow({
    operator,
    body,
    command: 'continue'
  });

  return {
    statusCode: 200,
    body: {
      operatorContext:
        reloaded.operatorResolution.body.operatorContext,
      declaredContext: reloaded.declaredContext,
      preparation:
        reloaded.preparationResolution.body.preparation,
      conversationResponse:
        reloaded.conversation.conversationResponse,
      workflowExecution: {
        status: execution.status,
        reason: execution.reason,
        blockedBy: execution.blockedBy,
        executedActions: execution.executedActions,
        executedActionCount: execution.executedActionCount,
        securityStateChanged:
          execution.securityStateChanged === true,
        deploymentDecisionWritten: false,
        humanReviewRequired: true
      },
      securityStateChanged:
        execution.securityStateChanged === true,
      securityDecisionCreated: false,
      deploymentDecisionWritten: false,
      humanReviewRequired: true
    },
    internal: {
      operatorContext:
        reloaded.operatorResolution.internal,
      preparation:
        reloaded.preparationResolution.internal,
      workflowExecution: execution,
      workflowState:
        reloaded.conversation.internal.workflowState
    }
  };
}

export async function handleHostedAgentApi({
  pathname,
  method,
  operator,
  body
} = {}) {
  const handledPath = new Set([
    HOSTED_AGENT_PREPARATION_PATH,
    HOSTED_AGENT_CONTEXT_PATH,
    HOSTED_AGENT_APPLICABILITY_PATH,
    HOSTED_AGENT_BOUNDED_TEST_PREPARE_PATH,
    HOSTED_AGENT_BOUNDED_TEST_COMPLETE_PATH,
    HOSTED_AGENT_REMEDIATION_PREPARE_PATH,
    HOSTED_AGENT_REMEDIATION_COMPLETE_PATH,
    HOSTED_AGENT_CHANGED_SNAPSHOT_PATH,
    HOSTED_AGENT_REMEDIATION_APPLICABILITY_PATH,
    HOSTED_AGENT_EXACT_RETEST_PREPARE_PATH,
    HOSTED_AGENT_EXACT_RETEST_COMPLETE_PATH,
    HOSTED_AGENT_CONTINUE_PATH
  ]).has(pathname);
  if (!handledPath) {
    return { handled: false };
  }
  if (method !== 'POST') {
    return {
      handled: true,
      statusCode: 405,
      body: {
        error: 'Method not allowed.',
        code: 'HOSTED_AGENT_METHOD_NOT_ALLOWED',
        deploymentDecisionWritten: false,
        humanReviewRequired: true
      }
    };
  }
  if (!operator?.id) {
    return {
      handled: true,
      statusCode: 401,
      body: {
        error: 'Sign in required.',
        code: 'HOSTED_OPERATOR_AUTHENTICATION_REQUIRED',
        deploymentDecisionWritten: false,
        humanReviewRequired: true
      }
    };
  }

  try {
    let result;
    if (pathname === HOSTED_AGENT_CONTEXT_PATH) {
      result = await updateHostedAgentAssessmentContext({ operator, body });
    } else if (pathname === HOSTED_AGENT_APPLICABILITY_PATH) {
      result = await confirmHostedAgentApplicability({ operator, body });
    } else if (pathname === HOSTED_AGENT_BOUNDED_TEST_PREPARE_PATH) {
      result = await prepareHostedAgentBoundedTest({ operator, body });
    } else if (pathname === HOSTED_AGENT_BOUNDED_TEST_COMPLETE_PATH) {
      result = await completeHostedAgentBoundedTest({ operator, body });
    } else if (
      pathname === HOSTED_AGENT_REMEDIATION_PREPARE_PATH
    ) {
      result = await prepareHostedAgentRemediation({
        operator,
        body
      });
    } else if (
      pathname === HOSTED_AGENT_REMEDIATION_COMPLETE_PATH
    ) {
      result = await completeHostedAgentRemediation({
        operator,
        body
      });
    } else if (
      pathname === HOSTED_AGENT_CHANGED_SNAPSHOT_PATH
    ) {
      result = await captureHostedAgentChangedSnapshot({
        operator,
        body
      });
    } else if (
      pathname ===
      HOSTED_AGENT_REMEDIATION_APPLICABILITY_PATH
    ) {
      result =
        await confirmHostedAgentRemediationApplicability({
          operator,
          body
        });
    } else if (
      pathname ===
      HOSTED_AGENT_EXACT_RETEST_PREPARE_PATH
    ) {
      result =
        await prepareHostedAgentExactRetest({
          operator,
          body
        });
    } else if (
      pathname ===
      HOSTED_AGENT_EXACT_RETEST_COMPLETE_PATH
    ) {
      result =
        await completeHostedAgentExactRetest({
          operator,
          body
        });
    } else if (pathname === HOSTED_AGENT_CONTINUE_PATH) {
      result = await continueHostedAgentAssessment({ operator, body });
    } else {
      result = await prepareHostedAgentAssessment({ operator, body });
    }
    return {
      handled: true,
      statusCode: result.statusCode,
      body: result.body,
      internal: result.internal
    };
  } catch (error) {
    return {
      handled: true,
      statusCode: statusForError(error),
      body: publicError(error)
    };
  }
}
