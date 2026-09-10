import {
  prepareAuthoritativeAssessmentWorkflowFromFrozenInspection
} from './tools/prepare-authoritative-assessment-workflow.mjs';
import {
  FROZEN_INSPECTION_TRANSPORT_SCHEMA,
  buildFrozenInspectionTransport,
  normaliseFrozenInspectionTransport
} from './frozen-inspection-transport.mjs';

export {
  FROZEN_INSPECTION_TRANSPORT_SCHEMA,
  buildFrozenInspectionTransport,
  normaliseFrozenInspectionTransport
} from './frozen-inspection-transport.mjs';

const FORBIDDEN_CALLER_AUTHORITY_FIELDS = Object.freeze([
  'userId',
  'projectId',
  'assessmentId',
  'workspaceId',
  'systemSnapshotId',
  'findingId',
  'deploymentDecision'
]);

function transportError(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}

export function normaliseHostedAssessmentPreparationInput(body = {}) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    throw transportError(
      'HOSTED_ASSESSMENT_INPUT_INVALID',
      'Hosted assessment preparation requires a JSON object.'
    );
  }

  for (const field of FORBIDDEN_CALLER_AUTHORITY_FIELDS) {
    if (Object.hasOwn(body, field)) {
      throw transportError(
        'HOSTED_ASSESSMENT_AUTHORITY_FIELD_REJECTED',
        `Caller-supplied ${field} is not accepted.`
      );
    }
  }

  return {
    frozenInspection: normaliseFrozenInspectionTransport(
      body.frozenInspection
    )
  };
}

function publicPreparation(preparation) {
  return {
    type: preparation.type,
    ready: preparation.ready === true,
    target: {
      source: preparation.target?.source || 'local_git',
      revision: preparation.target?.revision || null,
      dirty: preparation.target?.dirty === true
    },
    inspectorBinding: {
      verified: preparation.inspectorBinding?.verified === true,
      revisionBefore: preparation.inspectorBinding?.revisionBefore || null,
      revisionAfter: preparation.inspectorBinding?.revisionAfter || null
    },
    targetContextBinding: {
      type: preparation.targetContextBinding?.type || 'target_context_binding',
      status: preparation.targetContextBinding?.status || 'unavailable',
      verified: preparation.targetContextBinding?.verified === true,
      reason: preparation.targetContextBinding?.reason || null,
      targetRevision: preparation.targetContextBinding?.targetRevision || null,
      declaredRevision: preparation.targetContextBinding?.declaredRevision || null
    },
    assessmentContextBinding: {
      type: preparation.assessmentContextBinding?.type || 'assessment_context_binding',
      status: preparation.assessmentContextBinding?.status || 'unavailable',
      verified: preparation.assessmentContextBinding?.verified === true,
      reason: preparation.assessmentContextBinding?.reason || null
    },
    assessmentWorkflow: preparation.assessmentWorkflow,
    evidencePlan: preparation.evidencePlan,
    securityDecisionCreated: false,
    deploymentDecisionWritten: false,
    humanReviewRequired: true
  };
}

export async function resolveHostedAssessmentPreparation({
  operatorContextInternal,
  body
} = {}) {
  const userId = String(operatorContextInternal?.userId || '').trim();
  const projectId = String(operatorContextInternal?.projectId || '').trim();
  const assessmentId = String(operatorContextInternal?.assessmentId || '').trim();
  if (!userId || !projectId || !assessmentId) {
    throw transportError(
      'HOSTED_OPERATOR_CONTEXT_REQUIRED',
      'Server-resolved ARL operator context is required before assessment preparation.'
    );
  }

  const input = normaliseHostedAssessmentPreparationInput(body);
  const preparation = await prepareAuthoritativeAssessmentWorkflowFromFrozenInspection({
    frozenInspection: input.frozenInspection,
    projectId,
    userId,
    assessmentId
  });

  return {
    statusCode: 200,
    body: {
      preparation: publicPreparation(preparation)
    },
    internal: preparation,
    securityStateChanged: false,
    deploymentDecisionWritten: false,
    humanReviewRequired: true
  };
}
