import {
  createHash
} from 'node:crypto';
import path from 'node:path';

import { db } from '../db.js';

import {
  createSystemSnapshot
} from '../control-intelligence.js';

import {
  resolveSnapshotBoundActiveRemediation
} from './active-remediation-lineage.mjs';

import {
  normaliseFrozenInspectionTransport
} from './frozen-inspection-transport.mjs';

import {
  freezeLocalRepository
} from './tools/freeze-local-repository.mjs';

import {
  inspectFrozenRepository
} from './tools/inspect-frozen-repository.mjs';

import {
  getAssessmentContext
} from './tools/get-assessment-context.mjs';

import {
  getAuthoritativeAssessment
} from './tools/get-authoritative-assessment.mjs';

export const CHANGED_SYSTEM_SNAPSHOT_HANDOFF_SCHEMA =
  'arl.agent.changed-system-snapshot-handoff.v1';

export const CHANGED_SYSTEM_SNAPSHOT_EXECUTION_SCHEMA =
  'arl.agent.changed-system-snapshot-execution.v1';

const WORKFLOW_STATE_SCHEMA =
  'arl.agent.workflow-state.v1';

function clean(value) {
  return String(value ?? '').trim();
}

function assessmentBindingMatches(
  assessmentContext,
  assessmentId
) {
  return (
    clean(
      assessmentContext?.assessmentConfiguration
        ?.assessmentBinding?.assessmentId
    ) === clean(assessmentId)
  );
}

function targetRevision(assessmentContext) {
  const revision = clean(
    assessmentContext?.assessmentConfiguration
      ?.targetBinding?.revision
  ).toLowerCase();

  return /^[a-f0-9]{40}$/.test(revision)
    ? revision
    : null;
}

function normaliseRequest(text) {
  return String(text || '')
    .trim()
    .toLowerCase()
    .replace(/[—–]/g, '-')
    .replace(/\s+/g, ' ');
}

export function detectChangedSnapshotCommand(userRequest) {
  const text = normaliseRequest(userRequest);

  if (!text) {
    return null;
  }

  const snapshotRequest =
    /\b(?:capture|create|record|update)\b[^.]{0,80}\b(?:changed|new)\b[^.]{0,40}\b(?:system\s+)?snapshot\b/.test(text) ||
    /\b(?:capture|create|record|update)\b[^.]{0,80}\bsnapshot\b/.test(text);

  const unchangedConfirmation =
    /\barchitecture\s+(?:is\s+|has\s+remained\s+)?unchanged\b/.test(text) ||
    /\bno\s+architecture\s+changes?\b/.test(text);

  if (snapshotRequest && unchangedConfirmation) {
    return 'snapshot_confirm_unchanged';
  }

  if (snapshotRequest) {
    return 'snapshot';
  }

  return null;
}

async function snapshotBoundActiveRemediation({
  projectId,
  systemSnapshotId
}) {
  return resolveSnapshotBoundActiveRemediation({
    projectId,
    systemSnapshotId
  });
}

function revisionFromAssetName(name) {
  const match = String(name || '')
    .match(/@([a-f0-9]{40})$/i);

  return match?.[1]?.toLowerCase() || null;
}

async function implementationForRevision({
  projectId,
  findingId,
  revision
}) {
  const rows = await db.prepare(`
    SELECT
      a.id AS artifact_id,
      a.source_id,
      s.source,
      s.assets_json
    FROM remediation_evidence_artifacts a
    JOIN asset_snapshots s
      ON s.id=a.source_id
     AND s.project_id=a.project_id
    WHERE a.project_id=?
      AND a.remediation_id=?
      AND a.artifact_type='implementation'
      AND a.source_type='asset_snapshot'
      AND a.lifecycle_state='active'
      AND a.invalidated_at IS NULL
    ORDER BY a.created_at DESC,a.id DESC
  `).all(
    projectId,
    findingId
  );

  const matches = [];

  for (const row of rows) {
    if (row.source !== 'arl-agent-git-remediation') {
      continue;
    }

    let assets;
    try {
      assets = JSON.parse(row.assets_json || '[]');
    } catch {
      continue;
    }

    if (!Array.isArray(assets)) {
      continue;
    }

    const revisions = assets
      .map((asset) => revisionFromAssetName(asset?.name))
      .filter(Boolean);

    if (revisions.includes(revision)) {
      matches.push(row);
    }
  }

  if (matches.length === 0) {
    return {
      available: false,
      reason: 'current_revision_implementation_evidence_required'
    };
  }

  if (matches.length !== 1) {
    return {
      available: false,
      reason: 'current_revision_implementation_evidence_ambiguous',
      candidateCount: matches.length
    };
  }

  return {
    available: true,
    artifactId: matches[0].artifact_id,
    sourceId: matches[0].source_id
  };
}

function publicArtifacts({
  assessmentContext,
  authoritativeAssessment,
  frozen,
  baselineRevision,
  remediation = null
}) {
  return {
    frozenTarget: {
      available: Boolean(frozen?.revision),
      repositoryPath: frozen?.repositoryPath || null,
      revision: frozen?.revision || null,
      inspectorBindingVerified: false
    },
    assessmentContext: {
      available:
        assessmentContext?.available === true,
      projectId:
        assessmentContext?.projectId || null,
      systemSnapshotId:
        assessmentContext?.systemSnapshotId || null,
      systemSnapshotStatus:
        assessmentContext?.systemSnapshotStatus || null
    },
    authoritativeAssessment: {
      available:
        authoritativeAssessment?.available === true,
      assessmentId:
        authoritativeAssessment?.assessmentId || null
    },
    bindings: {
      targetContextVerified:
        Boolean(
          frozen?.revision &&
          baselineRevision &&
          frozen.revision === baselineRevision
        ),
      assessmentContextVerified:
        assessmentBindingMatches(
          assessmentContext,
          authoritativeAssessment?.assessmentId
        )
    },
    evidencePlan: {
      available: false,
      state: null,
      boundedChecks: 0,
      manualItems: 0,
      mappedControls: []
    },
    controlIntelligence: {
      available: Boolean(remediation?.controlId),
      systemSnapshotId:
        assessmentContext?.systemSnapshotId || null,
      relevantControls:
        remediation?.controlId
          ? [
              {
                controlId: remediation.controlId,
                currentStage: 'remediation',
                chainStatus: 'remediation_in_progress',
                deploymentImpact: 'blocker',
                availableActions: []
              }
            ]
          : []
    },
    readiness: {
      available: false,
      decision: null,
      systemSnapshotId:
        assessmentContext?.systemSnapshotId || null,
      humanReviewRequired: true
    }
  };
}

function gateState({
  stage,
  actionName,
  actor = 'user',
  reason,
  blockerCode,
  assessmentContext,
  authoritativeAssessment,
  frozen,
  baselineRevision,
  remediation = null
}) {
  return {
    type: 'authoritative_workflow_state',
    schema: WORKFLOW_STATE_SCHEMA,
    available: true,
    stage,
    blocked: true,
    canAutoAdvance: false,
    blockers: [
      {
        code: blockerCode,
        source: 'changed_system_snapshot_handoff',
        userActionRequired: true
      }
    ],
    authoritativeArtifacts:
      publicArtifacts({
        assessmentContext,
        authoritativeAssessment,
        frozen,
        baselineRevision,
        remediation
      }),
    scopedControl:
      remediation?.controlId
        ? {
            controlId: remediation.controlId,
            currentStage: 'remediation',
            chainStatus: 'remediation_in_progress',
            nextAction: reason,
            deploymentImpact: 'blocker'
          }
        : null,
    nextAllowedAction: {
      name: actionName,
      actor,
      requiresUserInput: true,
      reason,
      controlId: remediation?.controlId || null,
      caseId: null
    },
    readiness: {
      available: false,
      decision: null,
      systemSnapshotId:
        assessmentContext?.systemSnapshotId || null,
      humanReviewRequired: true
    },
    deploymentDecisionWritten: false,
    humanReviewRequired: true
  };
}

function execution({
  status,
  securityStateChanged = false
}) {
  return {
    type: 'changed_system_snapshot_execution',
    schema: CHANGED_SYSTEM_SNAPSHOT_EXECUTION_SCHEMA,
    status,
    executedActionCount:
      securityStateChanged ? 1 : 0,
    executedActions:
      securityStateChanged
        ? [
            {
              action: 'capture_changed_system_snapshot',
              outcome: 'executed',
              securityStateChanged: true
            }
          ]
        : [],
    securityStateChanged,
    deploymentDecisionWritten: false,
    humanReviewRequired: true
  };
}

function unavailable(reason) {
  return {
    type: 'changed_system_snapshot_handoff',
    schema: CHANGED_SYSTEM_SNAPSHOT_HANDOFF_SCHEMA,
    available: false,
    reason,
    securityStateChanged: false,
    deploymentDecisionWritten: false,
    humanReviewRequired: true
  };
}

function blockedResult({
  reason,
  state,
  extra = {}
}) {
  return {
    type: 'changed_system_snapshot_handoff',
    schema: CHANGED_SYSTEM_SNAPSHOT_HANDOFF_SCHEMA,
    available: true,
    status: 'user_action_required',
    reason,
    workflowState: state,
    execution: execution({
      status: 'user_action_required'
    }),
    securityStateChanged: false,
    deploymentDecisionWritten: false,
    humanReviewRequired: true,
    ...extra
  };
}

export async function captureChangedSystemSnapshotFromFrozenInspection({
  frozenInspection,
  projectId,
  userId,
  assessmentId,
  confirmArchitectureUnchanged = false
} = {}) {
  if (!projectId || !userId || !assessmentId) {
    return unavailable(
      'authoritative_snapshot_identity_required'
    );
  }

  let frozen;

  try {
    frozen =
      normaliseFrozenInspectionTransport(
        frozenInspection
      );
  } catch (error) {
    return unavailable(
      error?.code ||
      'frozen_remediation_inspection_required'
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
    !assessmentBindingMatches(
      assessmentContext,
      authoritativeAssessment.assessmentId
    )
  ) {
    return unavailable(
      'assessment_context_binding_mismatch'
    );
  }

  const baselineRevision =
    targetRevision(assessmentContext);

  if (!baselineRevision) {
    return unavailable(
      'authoritative_baseline_revision_required'
    );
  }

  const currentRevision =
    frozen.target.revision;

  if (currentRevision === baselineRevision) {
    return unavailable(
      'repository_revision_unchanged'
    );
  }

  const remediation =
    await snapshotBoundActiveRemediation({
      projectId,
      systemSnapshotId:
        assessmentContext.systemSnapshotId
    });

  if (!remediation.available) {
    return {
      ...unavailable(remediation.reason),
      candidateCount:
        remediation.candidateCount || 0
    };
  }

  const implementation =
    await implementationForRevision({
      projectId,
      findingId: remediation.findingId,
      revision: currentRevision
    });

  if (!implementation.available) {
    return unavailable(
      implementation.reason
    );
  }

  if (confirmArchitectureUnchanged !== true) {
    return {
      ...unavailable(
        'architecture_confirmation_required'
      ),
      confirmationRequired: true
    };
  }

  const previousConfiguration =
    assessmentContext.assessmentConfiguration || {};

  const created =
    await createSystemSnapshot({
      projectId,
      userId,
      input: {
        architecture:
          assessmentContext.architecture || {},
        models:
          assessmentContext.models || [],
        tools:
          assessmentContext.tools || [],
        identities:
          assessmentContext.identities || [],
        dataSources:
          assessmentContext.dataSources || [],
        networkAccess:
          assessmentContext.networkAccess || [],
        autonomyLevel:
          assessmentContext.autonomyLevel ||
          'unknown',
        approvalConfiguration:
          assessmentContext.approvalConfiguration ||
          {},
        assessmentConfiguration: {
          ...previousConfiguration,
          targetBinding: {
            schema: 'arl.target-binding.v1',
            source: 'git',
            revision: currentRevision
          },
          assessmentBinding: {
            schema: 'arl.assessment-binding.v1',
            assessmentId:
              authoritativeAssessment.assessmentId
          },
          remediationSnapshotConfirmation: {
            schema:
              'arl.remediation-snapshot-confirmation.v1',
            previousSystemSnapshotId:
              assessmentContext.systemSnapshotId,
            architectureUnchanged: true,
            applicabilityReviewReset: true,
            confirmationMethod:
              'explicit_user_conversation',
            confirmationDigest:
              createHash('sha256')
                .update(
                  JSON.stringify({
                    previousSystemSnapshotId:
                      assessmentContext.systemSnapshotId,
                    previousRevision:
                      baselineRevision,
                    currentRevision,
                    architectureUnchanged: true,
                    applicabilityReviewReset: true
                  })
                )
                .digest('hex')
          }
        },
        source:
          'arl-agent-remediation-confirmed',
        expectedCurrentSnapshotId:
          assessmentContext.systemSnapshotId
      }
    });

  return {
    type: 'changed_system_snapshot_handoff',
    schema:
      CHANGED_SYSTEM_SNAPSHOT_HANDOFF_SCHEMA,
    available: true,
    status: 'snapshot_recorded',
    reason:
      'changed_system_snapshot_recorded',
    securityStateChanged:
      created.created === true,
    snapshotCreated:
      created.created === true,
    previousRevision:
      baselineRevision,
    currentRevision,
    controlId:
      remediation.controlId,
    execution: execution({
      status: 'snapshot_recorded',
      securityStateChanged:
        created.created === true
    }),
    deploymentDecisionWritten: false,
    humanReviewRequired: true,
    internal: {
      previousSystemSnapshotId:
        assessmentContext.systemSnapshotId,
      systemSnapshotId:
        created.snapshot.id,
      findingId:
        remediation.findingId,
      implementationArtifactId:
        implementation.artifactId
    }
  };
}

export async function captureChangedSystemSnapshotHandoff({
  repositoryPath,
  projectId,
  userId,
  assessmentId,
  confirmArchitectureUnchanged = false
} = {}) {
  if (
    !repositoryPath ||
    !projectId ||
    !userId ||
    !assessmentId
  ) {
    return unavailable(
      'authoritative_snapshot_identity_required'
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
    !assessmentBindingMatches(
      assessmentContext,
      authoritativeAssessment.assessmentId
    )
  ) {
    return unavailable(
      'assessment_context_binding_mismatch'
    );
  }

  const baselineRevision =
    targetRevision(assessmentContext);

  if (!baselineRevision) {
    return unavailable(
      'authoritative_baseline_revision_required'
    );
  }

  const frozen =
    await freezeLocalRepository(repositoryPath);

  if (frozen.dirty) {
    const state = gateState({
      stage: 'remediation_worktree_clean_required',
      actionName:
        'commit_and_clean_remediation_worktree',
      reason:
        'A changed authoritative snapshot requires a clean committed Git revision.',
      blockerCode: 'remediation_worktree_dirty',
      assessmentContext,
      authoritativeAssessment,
      frozen,
      baselineRevision
    });

    return blockedResult({
      reason: 'remediation_worktree_dirty',
      state
    });
  }

  if (frozen.revision === baselineRevision) {
    const state = gateState({
      stage: 'remediation_change_required',
      actionName: 'commit_remediation_change',
      reason:
        'The repository still matches the revision bound to the vulnerable snapshot.',
      blockerCode: 'repository_revision_unchanged',
      assessmentContext,
      authoritativeAssessment,
      frozen,
      baselineRevision
    });

    return blockedResult({
      reason: 'repository_revision_unchanged',
      state
    });
  }

  const remediation =
    await snapshotBoundActiveRemediation({
      projectId,
      systemSnapshotId:
        assessmentContext.systemSnapshotId
    });

  if (!remediation.available) {
    const ambiguous =
      remediation.reason ===
      'active_authoritative_remediation_ambiguous';

    const state = gateState({
      stage:
        ambiguous
          ? 'remediation_lineage_resolution_required'
          : 'remediation_required',
      actionName:
        ambiguous
          ? 'review_remediation_lineage'
          : 'review_current_findings',
      actor: ambiguous ? 'human' : 'user',
      reason:
        ambiguous
          ? 'More than one active remediation is bound to the current vulnerable snapshot. ARL will not choose a remediation lineage automatically.'
          : 'No active remediation is bound to the current vulnerable snapshot.',
      blockerCode: remediation.reason,
      assessmentContext,
      authoritativeAssessment,
      frozen,
      baselineRevision
    });

    return blockedResult({
      reason: remediation.reason,
      state,
      extra: {
        candidateCount:
          remediation.candidateCount || 0
      }
    });
  }

  const implementation =
    await implementationForRevision({
      projectId,
      findingId: remediation.findingId,
      revision: frozen.revision
    });

  if (!implementation.available) {
    const state = gateState({
      stage: 'remediation_required',
      actionName: 'provide_remediation_implementation',
      reason:
        'The current Git revision is not yet bound to remediation implementation evidence for the active finding.',
      blockerCode: implementation.reason,
      assessmentContext,
      authoritativeAssessment,
      frozen,
      baselineRevision,
      remediation
    });

    return blockedResult({
      reason: implementation.reason,
      state
    });
  }

  if (confirmArchitectureUnchanged !== true) {
    const state = gateState({
      stage:
        'changed_system_snapshot_confirmation_required',
      actionName:
        'confirm_architecture_unchanged_or_update_context',
      reason:
        'ARL will not copy the previous declared architecture into a new authoritative snapshot without explicit confirmation that the remediation did not change that architecture.',
      blockerCode:
        'architecture_confirmation_required',
      assessmentContext,
      authoritativeAssessment,
      frozen,
      baselineRevision,
      remediation
    });

    return blockedResult({
      reason: 'architecture_confirmation_required',
      state
    });
  }

  const inspected =
    await inspectFrozenRepository(repositoryPath);

  if (inspected.target.revision !== frozen.revision) {
    return unavailable(
      'repository_revision_changed_during_snapshot_capture'
    );
  }

  const previousConfiguration =
    assessmentContext.assessmentConfiguration || {};

  const created =
    await createSystemSnapshot({
      projectId,
      userId,
      input: {
        architecture:
          assessmentContext.architecture || {},
        models:
          assessmentContext.models || [],
        tools:
          assessmentContext.tools || [],
        identities:
          assessmentContext.identities || [],
        dataSources:
          assessmentContext.dataSources || [],
        networkAccess:
          assessmentContext.networkAccess || [],
        autonomyLevel:
          assessmentContext.autonomyLevel || 'unknown',
        approvalConfiguration:
          assessmentContext.approvalConfiguration || {},
        assessmentConfiguration: {
          ...previousConfiguration,
          targetBinding: {
            schema: 'arl.target-binding.v1',
            source: 'git',
            revision: inspected.target.revision
          },
          assessmentBinding: {
            schema: 'arl.assessment-binding.v1',
            assessmentId:
              authoritativeAssessment.assessmentId
          },
          remediationSnapshotConfirmation: {
            schema:
              'arl.remediation-snapshot-confirmation.v1',
            previousSystemSnapshotId:
              assessmentContext.systemSnapshotId,
            architectureUnchanged: true,
            applicabilityReviewReset: true,
            confirmationMethod:
              'explicit_user_conversation',
            confirmationDigest:
              createHash('sha256')
                .update(
                  JSON.stringify({
                    previousSystemSnapshotId:
                      assessmentContext.systemSnapshotId,
                    previousRevision:
                      baselineRevision,
                    currentRevision:
                      inspected.target.revision,
                    architectureUnchanged: true,
                    applicabilityReviewReset: true
                  })
                )
                .digest('hex')
          }
        },
        source:
          'arl-agent-remediation-confirmed',
        expectedCurrentSnapshotId:
          assessmentContext.systemSnapshotId
      }
    });

  return {
    type: 'changed_system_snapshot_handoff',
    schema: CHANGED_SYSTEM_SNAPSHOT_HANDOFF_SCHEMA,
    available: true,
    status: 'snapshot_recorded',
    reason: 'changed_system_snapshot_recorded',
    securityStateChanged: created.created === true,
    snapshotCreated: created.created === true,
    previousSystemSnapshotId:
      assessmentContext.systemSnapshotId,
    systemSnapshotId: created.snapshot.id,
    previousRevision: baselineRevision,
    currentRevision: inspected.target.revision,
    findingId: remediation.findingId,
    controlId: remediation.controlId,
    implementationArtifactId:
      implementation.artifactId,
    execution: execution({
      status: 'snapshot_recorded',
      securityStateChanged:
        created.created === true
    }),
    deploymentDecisionWritten: false,
    humanReviewRequired: true
  };
}
