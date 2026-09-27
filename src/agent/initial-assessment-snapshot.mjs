import {
  createHash
} from 'node:crypto';

import {
  createSystemSnapshot
} from '../control-intelligence.js';
import {
  getAssessmentContext
} from './tools/get-assessment-context.mjs';
import {
  normaliseFrozenInspectionTransport
} from './frozen-inspection-transport.mjs';

export const INITIAL_ASSESSMENT_SNAPSHOT_SCHEMA =
  'arl.agent.initial-assessment-snapshot.v1';

export const HOSTED_RESUME_INSPECTION_SCHEMA =
  'arl.agent.hosted-resume-inspection.v1';

function snapshotError(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}

function requiredInternalContext(operatorContextInternal = {}) {
  const userId = String(operatorContextInternal.userId || '').trim();
  const projectId = String(operatorContextInternal.projectId || '').trim();
  const assessmentId = String(operatorContextInternal.assessmentId || '').trim();
  if (!userId || !projectId || !assessmentId) {
    throw snapshotError(
      'INITIAL_ASSESSMENT_OPERATOR_CONTEXT_REQUIRED',
      'Server-resolved operator, project and assessment context is required.'
    );
  }
  return { userId, projectId, assessmentId };
}

export function hostedResumeInspectionMarker(
  frozenInspection
) {
  const frozen =
    normaliseFrozenInspectionTransport(
      frozenInspection
    );

  /*
   * System snapshots intentionally reject secret/credential-like field names.
   * The full Inspector transport contains scan-scope metadata such as
   * gitHistorySecretScan, so it must not be embedded verbatim.
   *
   * Current Evidence Plan derivation requires only proof that a verified
   * source inspection exists; it does not consume Inspector findings or scope
   * configuration. Persist the exact target binding plus a digest of the
   * original transport and a minimal non-sensitive inspection projection.
   */
  const sourceInspectionDigest =
    createHash('sha256')
      .update(JSON.stringify(frozen))
      .digest('hex');

  return {
    schema: HOSTED_RESUME_INSPECTION_SCHEMA,
    source: 'transport_safe_snapshot_projection',
    sourceInspectionDigest,
    transport: {
      schema: frozen.schema,
      type: frozen.type,
      target: frozen.target,
      binding: frozen.binding,
      inspection: {
        schema:
          'arl.agent.hosted-resume-inspection-evidence.v1',
        observed: true,
        sourceInspectionDigest
      }
    }
  };
}

function initialSnapshotInput({
  revision,
  assessmentId,
  frozenInspection
}) {
  return {
    architecture: {
      summary:
        'Initial ARL assessment context. Architecture details remain explicitly unknown until authoritative customer context is provided.',
      components: []
    },
    models: [],
    tools: [],
    identities: [],
    dataSources: [],
    networkAccess: [],
    autonomyLevel: 'unknown',
    approvalConfiguration: {
      status: 'unknown'
    },
    assessmentConfiguration: {
      profile: 'ARL-RKA-1.2.0',
      architectureFacts: [],
      targetBinding: {
        schema: 'arl.target-binding.v1',
        source: 'git',
        revision
      },
      assessmentBinding: {
        schema: 'arl.assessment-binding.v1',
        assessmentId
      },
      hostedResumeInspection:
        hostedResumeInspectionMarker(
          frozenInspection
        ),
      initialContext: {
        schema: INITIAL_ASSESSMENT_SNAPSHOT_SCHEMA,
        mode: 'explicit_unknown_only',
        architectureInferred: false,
        controlDecisionInferred: false
      }
    },
    source: 'arl_agent_hosted_initial_assessment'
  };
}

export async function ensureInitialAssessmentSnapshot({
  operatorContextInternal,
  frozenInspection
} = {}) {
  const { userId, projectId, assessmentId } =
    requiredInternalContext(operatorContextInternal);
  const frozen = normaliseFrozenInspectionTransport(frozenInspection);

  const existing = await getAssessmentContext({ projectId, userId });
  if (existing.available === true) {
    return {
      schema: INITIAL_ASSESSMENT_SNAPSHOT_SCHEMA,
      available: true,
      created: false,
      reason: 'existing_authoritative_snapshot',
      revision: frozen.target.revision,
      architectureInferred: false,
      controlDecisionInferred: false,
      deploymentDecisionWritten: false,
      humanReviewRequired: true
    };
  }

  if (existing.reason !== 'authoritative_system_snapshot_required') {
    throw snapshotError(
      'INITIAL_ASSESSMENT_CONTEXT_UNAVAILABLE',
      `Initial authoritative context could not be created: ${existing.reason || 'unknown reason'}.`
    );
  }

  const result = await createSystemSnapshot({
    projectId,
    userId,
    input: initialSnapshotInput({
      revision: frozen.target.revision,
      assessmentId,
      frozenInspection: frozen
    })
  });

  return {
    schema: INITIAL_ASSESSMENT_SNAPSHOT_SCHEMA,
    available: true,
    created: result?.created === true,
    reason:
      result?.created === true
        ? 'explicit_unknown_initial_snapshot_created'
        : 'matching_authoritative_snapshot_reused',
    revision: frozen.target.revision,
    architectureInferred: false,
    controlDecisionInferred: false,
    deploymentDecisionWritten: false,
    humanReviewRequired: true
  };
}
