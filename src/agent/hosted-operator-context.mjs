import {
  bootstrapAuthenticatedOperatorContext,
  publicOperatorContext,
  repositoryIdentityForHostedAuthority
} from './operator-context-bootstrap.mjs';

const FORBIDDEN_CLIENT_FIELDS = Object.freeze([
  'userId',
  'projectId',
  'assessmentId',
  'workspaceId',
  'deploymentDecision'
]);

function hostedContextError(code, message, details = {}) {
  const error = new Error(message);
  error.code = code;
  for (const [key, value] of Object.entries(details)) {
    Object.defineProperty(error, key, {
      value,
      enumerable: false,
      configurable: false,
      writable: false
    });
  }
  return error;
}

function cleanEnvironment(value) {
  const environment = String(value || 'test').trim().toLowerCase();
  if (environment === 'local') return 'development';
  if (!['development', 'test', 'staging'].includes(environment)) {
    throw hostedContextError(
      'HOSTED_OPERATOR_CONTEXT_ENVIRONMENT_INVALID',
      'Hosted ARL agent bootstrap is limited to development, test or staging environments.'
    );
  }
  return environment;
}

export function normaliseHostedOperatorContextInput(body = {}) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    throw hostedContextError(
      'HOSTED_OPERATOR_CONTEXT_INPUT_INVALID',
      'The hosted operator-context request must be a JSON object.'
    );
  }

  for (const field of FORBIDDEN_CLIENT_FIELDS) {
    if (Object.hasOwn(body, field)) {
      throw hostedContextError(
        'HOSTED_OPERATOR_CONTEXT_AUTHORITY_FIELD_REJECTED',
        `Caller-supplied ${field} is not accepted.`
      );
    }
  }

  return {
    repositoryIdentity: repositoryIdentityForHostedAuthority(
      body.repositoryIdentity || {}
    ),
    workspaceName: String(body.workspaceName || '').trim().slice(0, 100),
    environment: cleanEnvironment(body.environment)
  };
}

export async function resolveHostedOperatorContext({
  operator,
  body
} = {}) {
  if (!operator?.id) {
    throw hostedContextError(
      'HOSTED_OPERATOR_AUTHENTICATION_REQUIRED',
      'An authenticated ARL operator session is required.'
    );
  }

  const input = normaliseHostedOperatorContextInput(body);
  const context = await bootstrapAuthenticatedOperatorContext({
    repositoryIdentity: input.repositoryIdentity,
    operator,
    workspaceName: input.workspaceName,
    environment: input.environment
  });

  return {
    statusCode:
      context.created.project || context.created.assessment ? 201 : 200,
    body: {
      operatorContext: publicOperatorContext(context)
    },
    internal: context.internal,
    securityStateChanged:
      context.created.project || context.created.assessment,
    deploymentDecisionWritten: false,
    humanReviewRequired: true
  };
}

export function publicHostedOperatorContextError(error) {
  const payload = {
    error: error?.message || 'Hosted operator context could not be resolved.',
    code: error?.code || 'HOSTED_OPERATOR_CONTEXT_FAILED'
  };

  if (Array.isArray(error?.workspaceOptions)) {
    payload.workspaceOptions = error.workspaceOptions
      .map((value) => String(value || '').trim())
      .filter(Boolean);
  }

  return payload;
}
