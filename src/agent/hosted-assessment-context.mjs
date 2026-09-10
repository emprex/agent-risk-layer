import {
  createSystemSnapshot
} from '../control-intelligence.js';
import {
  ARCHITECTURE_FACTS
} from '../control-suggestions.js';
import {
  deriveCapabilityFacts,
  normaliseCapabilityProfile
} from '../../public/agent-capability-profile.js';
import {
  normaliseFrozenInspectionTransport
} from './frozen-inspection-transport.mjs';
import {
  getAssessmentContext
} from './tools/get-assessment-context.mjs';

export const HOSTED_ASSESSMENT_CONTEXT_SCHEMA =
  'arl.agent.hosted-assessment-context.v1';

const ALLOWED_DECLARED_CONTEXT_FIELDS = new Set([
  'architectureSummary',
  'capabilityProfile',
  'manualArchitectureFacts'
]);

function contextError(code, message, statusCode = 400) {
  const error = new Error(message);
  error.code = code;
  error.statusCode = statusCode;
  return error;
}

function cleanSummary(value) {
  const summary = String(value || '').trim();
  if (summary.length < 10) {
    throw contextError(
      'HOSTED_ASSESSMENT_CONTEXT_SUMMARY_REQUIRED',
      'Describe what the assessed agent does in at least 10 characters.'
    );
  }
  return summary.slice(0, 4000);
}

function normaliseManualFacts(value) {
  if (!Array.isArray(value)) {
    throw contextError(
      'HOSTED_ASSESSMENT_CONTEXT_FACTS_INVALID',
      'manualArchitectureFacts must be an array of supported architecture facts.'
    );
  }

  const supported = new Set(ARCHITECTURE_FACTS);
  const facts = [...new Set(
    value
      .map((item) => String(item || '').trim())
      .filter(Boolean)
  )].sort();

  const unsupported = facts.filter((fact) => !supported.has(fact));
  if (unsupported.length) {
    throw contextError(
      'HOSTED_ASSESSMENT_CONTEXT_FACT_UNSUPPORTED',
      `Unsupported architecture fact: ${unsupported[0]}.`
    );
  }

  return facts;
}

export function normaliseHostedDeclaredContext(input = {}) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw contextError(
      'HOSTED_ASSESSMENT_CONTEXT_INPUT_INVALID',
      'declaredContext must be a JSON object.'
    );
  }

  for (const key of Object.keys(input)) {
    if (!ALLOWED_DECLARED_CONTEXT_FIELDS.has(key)) {
      throw contextError(
        'HOSTED_ASSESSMENT_CONTEXT_FIELD_REJECTED',
        `Caller-supplied declared context field ${key} is not accepted.`
      );
    }
  }

  const capabilityProfile =
    normaliseCapabilityProfile(input.capabilityProfile || {});
  const manualArchitectureFacts =
    normaliseManualFacts(input.manualArchitectureFacts || []);
  const architectureFacts = [...new Set([
    ...manualArchitectureFacts,
    ...deriveCapabilityFacts(capabilityProfile)
  ])].sort();

  return {
    architectureSummary: cleanSummary(input.architectureSummary),
    capabilityProfile,
    manualArchitectureFacts,
    architectureFacts
  };
}

function requiredInternalContext(operatorContextInternal = {}) {
  const userId = String(operatorContextInternal.userId || '').trim();
  const projectId = String(operatorContextInternal.projectId || '').trim();
  const assessmentId = String(operatorContextInternal.assessmentId || '').trim();
  if (!userId || !projectId || !assessmentId) {
    throw contextError(
      'HOSTED_ASSESSMENT_CONTEXT_AUTHORITY_REQUIRED',
      'Server-resolved operator, project and assessment authority is required.'
    );
  }
  return { userId, projectId, assessmentId };
}

export async function getHostedDeclaredAssessmentContextStatus({
  operatorContextInternal
} = {}) {
  const { userId, projectId } =
    requiredInternalContext(operatorContextInternal);
  const current = await getAssessmentContext({ projectId, userId });
  if (current.available !== true) {
    return {
      schema: HOSTED_ASSESSMENT_CONTEXT_SCHEMA,
      available: false,
      confirmed: false,
      requiresCustomerContext: true,
      architectureFactCount: 0,
      deploymentDecisionWritten: false,
      humanReviewRequired: true
    };
  }

  const configuration = current.assessmentConfiguration || {};
  const confirmed =
    configuration.confirmed === true &&
    configuration.capabilityProfile &&
    typeof configuration.capabilityProfile === 'object';

  return {
    schema: HOSTED_ASSESSMENT_CONTEXT_SCHEMA,
    available: true,
    confirmed,
    requiresCustomerContext: !confirmed,
    architectureFactCount:
      Array.isArray(configuration.architectureFacts)
        ? configuration.architectureFacts.length
        : 0,
    capabilityProfileVersion:
      configuration.capabilityProfile?.version || null,
    architectureInferred: false,
    controlDecisionInferred: false,
    deploymentDecisionWritten: false,
    humanReviewRequired: true
  };
}

function assertCurrentBindings({
  assessmentContext,
  assessmentId,
  revision
}) {
  const configuration =
    assessmentContext?.assessmentConfiguration || {};
  const boundAssessmentId =
    String(configuration?.assessmentBinding?.assessmentId || '').trim();
  const boundRevision =
    String(configuration?.targetBinding?.revision || '').trim();

  if (!boundAssessmentId || boundAssessmentId !== assessmentId) {
    throw contextError(
      'HOSTED_ASSESSMENT_CONTEXT_BINDING_MISMATCH',
      'The current authoritative snapshot is not bound to this assessment.',
      409
    );
  }

  if (!boundRevision || boundRevision !== revision) {
    throw contextError(
      'HOSTED_ASSESSMENT_CONTEXT_TARGET_CHANGED',
      'The frozen repository revision changed after the assessment context was prepared. Re-run the assessment from the current repository revision.',
      409
    );
  }
}

export async function recordHostedDeclaredAssessmentContext({
  operatorContextInternal,
  frozenInspection,
  declaredContext,
  environment = 'test'
} = {}) {
  const { userId, projectId, assessmentId } =
    requiredInternalContext(operatorContextInternal);

  const frozen = normaliseFrozenInspectionTransport(frozenInspection);
  const current = await getAssessmentContext({ projectId, userId });
  if (current.available !== true || !current.systemSnapshotId) {
    throw contextError(
      'HOSTED_ASSESSMENT_CONTEXT_CURRENT_SNAPSHOT_REQUIRED',
      'A current authoritative assessment snapshot is required before customer context can be recorded.',
      409
    );
  }

  assertCurrentBindings({
    assessmentContext: current,
    assessmentId,
    revision: frozen.target.revision
  });

  const declared = normaliseHostedDeclaredContext(declaredContext);
  const existingConfiguration = current.assessmentConfiguration || {};
  const assessmentConfiguration = {
    ...existingConfiguration,
    architectureFacts: declared.architectureFacts,
    manualArchitectureFacts: declared.manualArchitectureFacts,
    capabilityProfile: declared.capabilityProfile,
    environment:
      String(existingConfiguration.environment || environment || 'test')
        .trim()
        .toLowerCase(),
    confirmed: true,
    customerContext: {
      schema: HOSTED_ASSESSMENT_CONTEXT_SCHEMA,
      mode: 'customer_declared',
      architectureInferred: false,
      controlDecisionInferred: false
    }
  };

  const result = await createSystemSnapshot({
    projectId,
    userId,
    input: {
      architecture: {
        ...(current.architecture || {}),
        summary: declared.architectureSummary
      },
      models: current.models || [],
      tools: current.tools || [],
      identities: current.identities || [],
      dataSources: current.dataSources || [],
      networkAccess: current.networkAccess || [],
      autonomyLevel: declared.capabilityProfile.autonomy,
      approvalConfiguration: current.approvalConfiguration || {},
      assessmentConfiguration,
      source: 'arl_agent_hosted_customer_context',
      expectedCurrentSnapshotId: current.systemSnapshotId
    }
  });

  return {
    schema: HOSTED_ASSESSMENT_CONTEXT_SCHEMA,
    available: true,
    created: result?.created === true,
    confirmed: true,
    requiresCustomerContext: false,
    capabilityProfile: declared.capabilityProfile,
    architectureFacts: declared.architectureFacts,
    manualArchitectureFacts: declared.manualArchitectureFacts,
    architectureInferred: false,
    controlDecisionInferred: false,
    securityStateChanged: result?.created === true,
    deploymentDecisionWritten: false,
    humanReviewRequired: true
  };
}
