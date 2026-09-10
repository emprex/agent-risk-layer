import {
  assessControlApplicability,
  getControlIntelligenceControl
} from '../control-intelligence.js';

import {
  freezeLocalRepository
} from './tools/freeze-local-repository.mjs';

import {
  getAssessmentContext
} from './tools/get-assessment-context.mjs';

import {
  getAuthoritativeAssessment
} from './tools/get-authoritative-assessment.mjs';

import { db } from '../db.js';

export const REMEDIATION_APPLICABILITY_HANDOFF_SCHEMA =
  'arl.agent.remediation-applicability-handoff.v1';

export const REMEDIATION_APPLICABILITY_EXECUTION_SCHEMA =
  'arl.agent.remediation-applicability-execution.v1';

function clean(value) {
  return String(value ?? '').trim();
}

function normalise(text) {
  return String(text || '')
    .trim()
    .toLowerCase()
    .replace(/[—–]/g, '-')
    .replace(/\s+/g, ' ');
}

export function detectRemediationApplicabilityCommand(
  userRequest
) {
  const text = normalise(userRequest);

  if (!text) {
    return null;
  }

  if (
    /\bcontrol\s+(?:is\s+)?still\s+(?:applicable|applies)\b/.test(text) ||
    /\bconfirm\s+(?:the\s+)?control\s+(?:is\s+)?(?:still\s+)?(?:applicable|applies)\b/.test(text) ||
    /^still\s+applicable[.!?]*$/.test(text)
  ) {
    return 'remediation_applicability_confirm';
  }

  return null;
}

function parseJson(value, fallback = {}) {
  try {
    return value && typeof value === 'object'
      ? value
      : JSON.parse(value || '{}');
  } catch {
    return fallback;
  }
}

function unavailable(reason) {
  return {
    type: 'remediation_applicability_handoff',
    schema: REMEDIATION_APPLICABILITY_HANDOFF_SCHEMA,
    available: false,
    status: 'blocked',
    reason,
    securityStateChanged: false,
    execution: {
      type: 'remediation_applicability_execution',
      schema: REMEDIATION_APPLICABILITY_EXECUTION_SCHEMA,
      status: 'blocked',
      executedActionCount: 0,
      executedActions: [],
      securityStateChanged: false,
      deploymentDecisionWritten: false,
      humanReviewRequired: true
    },
    deploymentDecisionWritten: false,
    humanReviewRequired: true
  };
}

function execution(changed) {
  return {
    type: 'remediation_applicability_execution',
    schema: REMEDIATION_APPLICABILITY_EXECUTION_SCHEMA,
    status:
      changed
        ? 'applicability_recorded'
        : 'already_recorded',
    executedActionCount: changed ? 1 : 0,
    executedActions:
      changed
        ? [
            {
              action:
                'record_guided_customer_applicability',
              outcome: 'executed',
              securityStateChanged: true
            }
          ]
        : [],
    securityStateChanged: changed,
    deploymentDecisionWritten: false,
    humanReviewRequired: true
  };
}

async function remediationLineage({
  projectId,
  previousSystemSnapshotId
}) {
  const rows = await db.prepare(`
    SELECT DISTINCT
      r.id AS finding_id,
      r.status AS finding_status,
      b.entry_id AS control_id
    FROM remediation_items r
    JOIN control_finding_bindings b
      ON b.finding_id=r.id
     AND b.project_id=r.project_id
    WHERE r.project_id=?
      AND b.system_snapshot_id=?
      AND r.status NOT IN ('verified_closed','accepted_risk')
    ORDER BY r.updated_at DESC,r.id
  `).all(
    projectId,
    previousSystemSnapshotId
  );

  if (rows.length === 0) {
    return {
      available: false,
      reason:
        'persisted_remediation_snapshot_lineage_not_found'
    };
  }

  if (rows.length !== 1) {
    return {
      available: false,
      reason:
        'persisted_remediation_snapshot_lineage_ambiguous',
      candidateCount: rows.length
    };
  }

  return {
    available: true,
    findingId: rows[0].finding_id,
    findingStatus: rows[0].finding_status,
    controlId: rows[0].control_id
  };
}

export async function recordRemediationApplicabilityConfirmationFromCurrentSnapshot({
  projectId,
  userId,
  assessmentId
} = {}) {
  if (!projectId || !userId || !assessmentId) {
    return unavailable(
      'authoritative_remediation_identity_required'
    );
  }

  const authoritativeAssessment =
    await getAuthoritativeAssessment({
      assessmentId,
      userId
    });

  if (!authoritativeAssessment.available) {
    return unavailable(
      authoritativeAssessment.reason ||
      'authoritative_assessment_required'
    );
  }

  const assessmentContext =
    await getAssessmentContext({
      projectId,
      userId
    });

  if (!assessmentContext.available) {
    return unavailable(
      assessmentContext.reason ||
      'authoritative_assessment_context_required'
    );
  }

  if (
    clean(
      assessmentContext?.assessmentConfiguration
        ?.assessmentBinding?.assessmentId
    ) !== clean(authoritativeAssessment.assessmentId)
  ) {
    return unavailable(
      'assessment_context_binding_mismatch'
    );
  }

  const marker =
    assessmentContext?.assessmentConfiguration
      ?.remediationSnapshotConfirmation;

  if (
    marker?.schema !==
      'arl.remediation-snapshot-confirmation.v1' ||
    marker.architectureUnchanged !== true ||
    marker.applicabilityReviewReset !== true ||
    !marker.previousSystemSnapshotId
  ) {
    return unavailable(
      'remediation_snapshot_confirmation_required'
    );
  }

  const boundRevision = clean(
    assessmentContext?.assessmentConfiguration
      ?.targetBinding?.revision
  ).toLowerCase();

  if (!/^[a-f0-9]{40}$/.test(boundRevision)) {
    return unavailable(
      'remediation_snapshot_target_binding_mismatch'
    );
  }

  const lineage =
    await remediationLineage({
      projectId,
      previousSystemSnapshotId:
        marker.previousSystemSnapshotId
    });

  if (!lineage.available) {
    return {
      ...unavailable(lineage.reason),
      candidateCount:
        lineage.candidateCount || 0
    };
  }

  const existing = await db.prepare(`
    SELECT decision,reason,evaluated_at
    FROM control_applicability_revisions
    WHERE project_id=?
      AND system_snapshot_id=?
      AND entry_id=?
    ORDER BY evaluated_at DESC,id DESC
    LIMIT 1
  `).get(
    projectId,
    assessmentContext.systemSnapshotId,
    lineage.controlId
  );

  if (existing?.decision === 'applicable') {
    return {
      type: 'remediation_applicability_handoff',
      schema:
        REMEDIATION_APPLICABILITY_HANDOFF_SCHEMA,
      available: true,
      status: 'already_recorded',
      reason:
        'fresh_remediation_applicability_already_recorded',
      controlId: lineage.controlId,
      securityStateChanged: false,
      execution: execution(false),
      deploymentDecisionWritten: false,
      humanReviewRequired: true,
      internal: {
        findingId: lineage.findingId,
        systemSnapshotId:
          assessmentContext.systemSnapshotId
      }
    };
  }

  if (
    existing &&
    existing.decision !== 'context_required'
  ) {
    return unavailable(
      'remediation_applicability_review_conflict'
    );
  }

  const detail =
    await getControlIntelligenceControl({
      projectId,
      controlId: lineage.controlId,
      userId
    });

  if (
    detail?.systemSnapshot?.id !==
      assessmentContext.systemSnapshotId
  ) {
    return unavailable(
      'current_remediation_snapshot_required'
    );
  }

  const architectureFacts =
    Array.isArray(
      assessmentContext?.assessmentConfiguration
        ?.architectureFacts
    )
      ? assessmentContext.assessmentConfiguration
          .architectureFacts
          .map((value) => clean(value))
          .filter(Boolean)
      : [];

  const recorded =
    await assessControlApplicability({
      projectId,
      controlId: lineage.controlId,
      userId,
      input: {
        snapshotId:
          assessmentContext.systemSnapshotId,
        decision: 'applicable',
        reason:
          'The customer explicitly confirmed that the remediation did not change the declared architecture and that this scoped control still applies to the remediated system.',
        architectureFactIds: architectureFacts,
        expectedEvaluationDigest:
          detail.applicability.evaluationDigest
      }
    });

  return {
    type: 'remediation_applicability_handoff',
    schema:
      REMEDIATION_APPLICABILITY_HANDOFF_SCHEMA,
    available: true,
    status: 'applicability_recorded',
    reason:
      'fresh_remediation_applicability_recorded',
    controlId: lineage.controlId,
    applicabilityDecision:
      recorded?.evaluation?.decision ||
      'applicable',
    securityStateChanged: true,
    execution: execution(true),
    deploymentDecisionWritten: false,
    humanReviewRequired: true,
    internal: {
      findingId: lineage.findingId,
      systemSnapshotId:
        assessmentContext.systemSnapshotId
    }
  };
}

export async function recordRemediationApplicabilityConfirmation({
  repositoryPath,
  projectId,
  userId,
  assessmentId
} = {}) {
  if (
    !repositoryPath ||
    !projectId ||
    !userId ||
    !assessmentId
  ) {
    return unavailable(
      'authoritative_remediation_identity_required'
    );
  }

  const authoritativeAssessment =
    await getAuthoritativeAssessment({
      assessmentId,
      userId
    });

  if (!authoritativeAssessment.available) {
    return unavailable(
      authoritativeAssessment.reason ||
      'authoritative_assessment_required'
    );
  }

  const assessmentContext =
    await getAssessmentContext({
      projectId,
      userId
    });

  if (!assessmentContext.available) {
    return unavailable(
      assessmentContext.reason ||
      'authoritative_assessment_context_required'
    );
  }

  if (
    clean(
      assessmentContext?.assessmentConfiguration
        ?.assessmentBinding?.assessmentId
    ) !== clean(authoritativeAssessment.assessmentId)
  ) {
    return unavailable(
      'assessment_context_binding_mismatch'
    );
  }

  const marker =
    assessmentContext?.assessmentConfiguration
      ?.remediationSnapshotConfirmation;

  if (
    marker?.schema !==
      'arl.remediation-snapshot-confirmation.v1' ||
    marker.architectureUnchanged !== true ||
    !marker.previousSystemSnapshotId
  ) {
    return unavailable(
      'remediation_snapshot_confirmation_required'
    );
  }

  const frozen =
    await freezeLocalRepository(repositoryPath);

  if (frozen.dirty) {
    return unavailable(
      'remediation_worktree_dirty'
    );
  }

  const boundRevision = clean(
    assessmentContext?.assessmentConfiguration
      ?.targetBinding?.revision
  ).toLowerCase();

  if (
    !/^[a-f0-9]{40}$/.test(boundRevision) ||
    frozen.revision !== boundRevision
  ) {
    return unavailable(
      'remediation_snapshot_target_binding_mismatch'
    );
  }

  const lineage =
    await remediationLineage({
      projectId,
      previousSystemSnapshotId:
        marker.previousSystemSnapshotId
    });

  if (!lineage.available) {
    return {
      ...unavailable(lineage.reason),
      candidateCount:
        lineage.candidateCount || 0
    };
  }

  const existing = await db.prepare(`
    SELECT decision,reason,evaluated_at
    FROM control_applicability_revisions
    WHERE project_id=?
      AND system_snapshot_id=?
      AND entry_id=?
    ORDER BY evaluated_at DESC,id DESC
    LIMIT 1
  `).get(
    projectId,
    assessmentContext.systemSnapshotId,
    lineage.controlId
  );

  if (existing?.decision === 'applicable') {
    return {
      type: 'remediation_applicability_handoff',
      schema: REMEDIATION_APPLICABILITY_HANDOFF_SCHEMA,
      available: true,
      status: 'already_recorded',
      reason:
        'fresh_remediation_applicability_already_recorded',
      controlId: lineage.controlId,
      findingId: lineage.findingId,
      systemSnapshotId:
        assessmentContext.systemSnapshotId,
      securityStateChanged: false,
      execution: execution(false),
      deploymentDecisionWritten: false,
      humanReviewRequired: true
    };
  }

  if (
    existing &&
    existing.decision !== 'context_required'
  ) {
    return unavailable(
      'remediation_applicability_review_conflict'
    );
  }

  const detail =
    await getControlIntelligenceControl({
      projectId,
      controlId: lineage.controlId,
      userId
    });

  if (
    detail?.systemSnapshot?.id !==
      assessmentContext.systemSnapshotId
  ) {
    return unavailable(
      'current_remediation_snapshot_required'
    );
  }

  const architectureFacts =
    Array.isArray(
      assessmentContext?.assessmentConfiguration
        ?.architectureFacts
    )
      ? assessmentContext.assessmentConfiguration
          .architectureFacts
          .map((value) => clean(value))
          .filter(Boolean)
      : [];

  const recorded =
    await assessControlApplicability({
      projectId,
      controlId: lineage.controlId,
      userId,
      input: {
        snapshotId:
          assessmentContext.systemSnapshotId,
        decision: 'applicable',
        reason:
          'The customer explicitly confirmed that the remediation did not change the declared architecture and that this scoped control still applies to the remediated system.',
        architectureFactIds: architectureFacts,
        expectedEvaluationDigest:
          detail.applicability.evaluationDigest
      }
    });

  return {
    type: 'remediation_applicability_handoff',
    schema: REMEDIATION_APPLICABILITY_HANDOFF_SCHEMA,
    available: true,
    status: 'applicability_recorded',
    reason:
      'fresh_remediation_applicability_recorded',
    controlId: lineage.controlId,
    findingId: lineage.findingId,
    systemSnapshotId:
      assessmentContext.systemSnapshotId,
    applicabilityDecision:
      recorded?.evaluation?.decision || 'applicable',
    securityStateChanged: true,
    execution: execution(true),
    deploymentDecisionWritten: false,
    humanReviewRequired: true
  };
}
