import {
  ROE_CONFIRMATION,
  createRedTeamAuthorisation,
  listRedTeamAuthorisations
} from '../redteam.js';
import {
  resolveHostedOperatorContext
} from './hosted-operator-context.mjs';
import {
  getHostedDeclaredAssessmentContextStatus
} from './hosted-assessment-context.mjs';
import {
  resolveHostedAssessmentPreparation
} from './hosted-assessment-preparation.mjs';
import {
  buildHostedPreparationConversation
} from './hosted-workflow-conversation.mjs';

export const HOSTED_BOUNDED_ROE_PATH =
  '/api/agent/assessment/bounded-test/authorise';

export const HOSTED_BOUNDED_ROE_SCHEMA =
  'arl.agent.hosted-bounded-roe.v1';

const ROE_WINDOW_MS = 60 * 60 * 1000;

function roeError(code, message, statusCode = 409) {
  const error = new Error(message);
  error.code = code;
  error.statusCode = statusCode;
  return error;
}

function activeSafeAuthorisations(authorisations, nowMs) {
  return (Array.isArray(authorisations) ? authorisations : []).filter((item) => {
    const start = Date.parse(item?.windowStart || '');
    const end = Date.parse(item?.windowEnd || '');
    return (
      item?.status === 'active' &&
      item?.environment === 'local' &&
      item?.syntheticDataOnly === true &&
      item?.dryRunToolsOnly === true &&
      Number.isFinite(start) &&
      Number.isFinite(end) &&
      start <= nowMs &&
      end > nowMs
    );
  });
}

function assertAuthorisationGate(workflowState) {
  const action = workflowState?.nextAllowedAction || null;
  if (
    workflowState?.stage !== 'bounded_test_required' ||
    action?.name !== 'authorise_and_run_bounded_test' ||
    action?.actor !== 'user' ||
    action?.requiresUserInput !== true
  ) {
    throw roeError(
      'HOSTED_BOUNDED_ROE_GATE_REQUIRED',
      'ARL is not currently waiting for explicit bounded-test authorisation.'
    );
  }
}

function normaliseEndpointOrigin(value) {
  let endpoint;
  try {
    endpoint = new URL(String(value || '').trim());
  } catch {
    throw roeError(
      'HOSTED_BOUNDED_ROE_ENDPOINT_INVALID',
      'A valid local adapter origin is required.',
      400
    );
  }
  if (
    endpoint.protocol !== 'http:' ||
    !['localhost', '127.0.0.1', '::1'].includes(endpoint.hostname) ||
    endpoint.username ||
    endpoint.password
  ) {
    throw roeError(
      'HOSTED_BOUNDED_ROE_ENDPOINT_INVALID',
      'Hosted bounded-test RoE creation is limited to an HTTP localhost adapter origin.',
      400
    );
  }
  return endpoint.origin;
}

async function resolveAuthoritativeWorkflow({
  operator,
  body,
  resolveOperatorContextImpl,
  getDeclaredContextImpl,
  resolvePreparationImpl,
  buildConversationImpl
}) {
  const operatorResolution = await resolveOperatorContextImpl({
    operator,
    body
  });
  const declaredContext = await getDeclaredContextImpl({
    operatorContextInternal: operatorResolution.internal
  });
  if (declaredContext?.confirmed !== true) {
    throw roeError(
      'HOSTED_ASSESSMENT_CONTEXT_REQUIRED',
      'Customer-declared agent context must be confirmed before bounded-test authorisation.'
    );
  }
  const preparationResolution = await resolvePreparationImpl({
    operatorContextInternal: operatorResolution.internal,
    body: {
      frozenInspection: body.frozenInspection
    }
  });
  const conversation = await buildConversationImpl({
    operatorContextInternal: operatorResolution.internal,
    preparation: preparationResolution.internal,
    command: 'continue'
  });
  assertAuthorisationGate(conversation.internal.workflowState);
  return {
    operatorResolution,
    workflowState: conversation.internal.workflowState
  };
}

export async function authoriseHostedBoundedRoe({
  operator,
  body = {},
  now = () => Date.now(),
  resolveOperatorContextImpl = resolveHostedOperatorContext,
  getDeclaredContextImpl = getHostedDeclaredAssessmentContextStatus,
  resolvePreparationImpl = resolveHostedAssessmentPreparation,
  buildConversationImpl = buildHostedPreparationConversation,
  listAuthorisationsImpl = listRedTeamAuthorisations,
  createAuthorisationImpl = createRedTeamAuthorisation
} = {}) {
  if (!operator?.id || !operator?.email) {
    throw roeError(
      'HOSTED_OPERATOR_AUTHENTICATION_REQUIRED',
      'An authenticated ARL operator is required.',
      401
    );
  }

  const endpointOrigin = normaliseEndpointOrigin(body.endpointOrigin);
  const authorityBasis = String(body.authorityBasis || '').trim();
  const authorisedRole = String(body.authorisedRole || '').trim();
  const confirmation = String(body.confirmation || '').trim();

  if (![
    'owner',
    'employee-authorised',
    'written-client-authority',
    'contractual-authority'
  ].includes(authorityBasis)) {
    throw roeError(
      'HOSTED_BOUNDED_ROE_AUTHORITY_BASIS_REQUIRED',
      'Choose the legal basis for controlled testing authority.',
      400
    );
  }
  if (authorisedRole.length < 2) {
    throw roeError(
      'HOSTED_BOUNDED_ROE_ROLE_REQUIRED',
      'The authoriser role is required.',
      400
    );
  }
  if (confirmation !== ROE_CONFIRMATION) {
    throw roeError(
      'HOSTED_BOUNDED_ROE_CONFIRMATION_REQUIRED',
      `Type exactly: ${ROE_CONFIRMATION}`,
      400
    );
  }

  const current = await resolveAuthoritativeWorkflow({
    operator,
    body,
    resolveOperatorContextImpl,
    getDeclaredContextImpl,
    resolvePreparationImpl,
    buildConversationImpl
  });
  const identity = current.operatorResolution.internal;
  const existing = activeSafeAuthorisations(
    await listAuthorisationsImpl({
      assessmentId: identity.assessmentId,
      userId: identity.userId
    }),
    now()
  );

  if (existing.length > 1) {
    throw roeError(
      'HOSTED_BOUNDED_ROE_AMBIGUOUS',
      'More than one active local Rules of Engagement record exists for this assessment.'
    );
  }
  if (existing.length === 1) {
    const currentRoe = existing[0];
    if (currentRoe.endpointOrigin !== endpointOrigin) {
      throw roeError(
        'HOSTED_BOUNDED_ROE_ENDPOINT_CONFLICT',
        'An active local Rules of Engagement record exists for a different adapter origin.'
      );
    }
    return {
      statusCode: 200,
      body: {
        authorisation: currentRoe,
        reused: true,
        securityStateChanged: false,
        deploymentDecisionWritten: false,
        humanReviewRequired: true
      }
    };
  }

  const startedAt = now();
  const targetName =
    String(
      current.operatorResolution.body?.operatorContext?.repository?.display ||
      'customer-operated local agent'
    ).trim();
  const authorisation = await createAuthorisationImpl({
    userId: identity.userId,
    assessmentId: identity.assessmentId,
    input: {
      targetName,
      endpointOrigin,
      environment: 'local',
      authorityBasis,
      authorisedBy: operator.email,
      authorisedRole,
      emergencyContact: operator.email,
      windowStart: new Date(startedAt).toISOString(),
      windowEnd: new Date(startedAt + ROE_WINDOW_MS).toISOString(),
      permittedActions: [
        'Execute one ARL-authorised bounded red-team case against the customer-operated localhost adapter.',
        'Record redacted synthetic tool-use evidence required by the authoritative Evidence Plan.'
      ],
      prohibitedActions: [
        'No production systems or production data.',
        'No real external network exfiltration, destructive effects, or credential use.'
      ],
      dataClassification: 'synthetic-only',
      retentionDays: 30,
      syntheticDataOnly: true,
      dryRunToolsOnly: true,
      noProductionEffects: true,
      confirmation
    }
  });

  return {
    statusCode: 201,
    body: {
      authorisation,
      reused: false,
      schema: HOSTED_BOUNDED_ROE_SCHEMA,
      securityStateChanged: true,
      deploymentDecisionWritten: false,
      humanReviewRequired: true
    }
  };
}

export async function handleHostedBoundedRoeApi({
  pathname,
  method,
  operator,
  body
} = {}) {
  if (pathname !== HOSTED_BOUNDED_ROE_PATH) {
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
  try {
    const result = await authoriseHostedBoundedRoe({
      operator,
      body
    });
    return {
      handled: true,
      ...result
    };
  } catch (error) {
    return {
      handled: true,
      statusCode: Number(error?.statusCode) || 400,
      body: {
        error: String(error?.message || 'Bounded-test authorisation failed.'),
        code: error?.code || 'HOSTED_BOUNDED_ROE_FAILED',
        deploymentDecisionWritten: false,
        humanReviewRequired: true
      }
    };
  }
}
