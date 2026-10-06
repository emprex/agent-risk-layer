import path from 'node:path';

import { db, id, nowIso } from '../db.js';

import {
  getControlIntelligenceControl
} from '../control-intelligence.js';

import {
  resolveSnapshotBoundActiveRemediation
} from './active-remediation-lineage.mjs';

import {
  recordAssetSnapshot
} from '../control-plane.js';

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

import {
  recordAuthoritativeRemediationImplementation
} from './tools/record-authoritative-remediation-implementation.mjs';

export const GIT_REMEDIATION_HANDOFF_SCHEMA =
  'arl.agent.git-remediation-handoff.v1';

export const REMEDIATION_EXECUTION_SCHEMA =
  'arl.agent.remediation-execution.v1';

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
  const value = clean(
    assessmentContext?.assessmentConfiguration
      ?.targetBinding?.revision
  ).toLowerCase();

  return /^[a-f0-9]{40}$/.test(value)
    ? value
    : null;
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

function revisionFromAssetName(name) {
  const match = String(name || '')
    .match(/@([a-f0-9]{40})$/i);

  return match?.[1]?.toLowerCase() || null;
}

async function recoverLegacyUnboundRetestImplementation({
  projectId,
  userId,
  findingId,
  revision
}) {
  const failedRetest =
    await db.prepare(`
      SELECT
        id,
        input_reference,
        completed_at
      FROM control_test_executions
      WHERE project_id=?
        AND remediation_id=?
        AND finding_id=?
        AND execution_kind='retest'
        AND result='failed'
      ORDER BY completed_at DESC,id DESC
      LIMIT 1
    `).get(
      projectId,
      findingId,
      findingId
    );

  if (!failedRetest?.input_reference) {
    return {
      available: false,
      reason: 'legacy_unbound_failed_retest_not_found'
    };
  }

  const match =
    String(failedRetest.input_reference)
      .match(
        /^redteam-failed-retest:(rtr_[a-f0-9]+):/i
      );

  if (!match?.[1]) {
    return {
      available: false,
      reason: 'failed_retest_redteam_lineage_required'
    };
  }

  const redteamRun =
    await db.prepare(`
      SELECT id,campaign_json
      FROM redteam_runs
      WHERE id=?
    `).get(match[1]);

  if (!redteamRun) {
    return {
      available: false,
      reason: 'failed_retest_redteam_run_required'
    };
  }

  const campaign =
    parseJson(redteamRun.campaign_json, {});
  const boundRevision =
    clean(campaign?.target?.revision).toLowerCase();

  if (/^[a-f0-9]{40}$/.test(boundRevision)) {
    return {
      available: false,
      reason: 'failed_retest_already_revision_bound',
      boundRevision
    };
  }

  const project =
    await db.prepare(`
      SELECT workspace_id
      FROM security_projects
      WHERE id=?
    `).get(projectId);

  if (!project?.workspace_id) {
    return {
      available: false,
      reason: 'project_workspace_required'
    };
  }

  const rows =
    await db.prepare(`
      SELECT
        a.id AS artifact_id,
        a.source_id,
        s.source,
        s.assets_json
      FROM remediation_evidence_artifacts a
      JOIN asset_snapshots s
        ON s.id=a.source_id
       AND s.project_id=a.project_id
      WHERE a.workspace_id=?
        AND a.project_id=?
        AND a.remediation_id=?
        AND a.artifact_type='implementation'
        AND a.source_type='asset_snapshot'
        AND a.lifecycle_state='invalidated'
        AND a.invalidated_at IS NOT NULL
      ORDER BY a.invalidated_at DESC,a.id DESC
    `).all(
      project.workspace_id,
      projectId,
      findingId
    );

  const matches = [];

  for (const row of rows) {
    if (row.source !== 'arl-agent-git-remediation') {
      continue;
    }

    const assets =
      parseJson(row.assets_json, []);

    if (!Array.isArray(assets)) {
      continue;
    }

    const revisions =
      assets
        .map((asset) =>
          revisionFromAssetName(asset?.name)
        )
        .filter(Boolean);

    if (revisions.includes(revision)) {
      matches.push(row);
    }
  }

  if (matches.length !== 1) {
    return {
      available: false,
      reason:
        matches.length === 0
          ? 'matching_invalidated_implementation_not_found'
          : 'matching_invalidated_implementation_ambiguous',
      candidateCount: matches.length
    };
  }

  const recoveredAt = nowIso();
  const artifact = matches[0];

  const updated =
    await db.prepare(`
      UPDATE remediation_evidence_artifacts
      SET lifecycle_state='active',
          invalidated_at=NULL
      WHERE id=?
        AND workspace_id=?
        AND project_id=?
        AND remediation_id=?
        AND lifecycle_state='invalidated'
        AND invalidated_at IS NOT NULL
    `).run(
      artifact.artifact_id,
      project.workspace_id,
      projectId,
      findingId
    );

  if (Number(updated.changes || 0) !== 1) {
    return {
      available: false,
      reason: 'implementation_recovery_conflict'
    };
  }

  await db.prepare(`
    INSERT INTO security_audit_log
    (id,workspace_id,project_id,actor_type,actor_id,action,target_type,target_id,metadata_json,created_at)
    VALUES (?,?,?,?,?,?,?,?,?,?)
  `).run(
    id('aud_'),
    project.workspace_id,
    projectId,
    'user',
    userId,
    'control_intelligence.legacy_unbound_retest_recovery',
    'remediation',
    findingId,
    JSON.stringify({
      failedRetestExecutionId:
        failedRetest.id,
      redteamRunId:
        redteamRun.id,
      restoredImplementationArtifactId:
        artifact.artifact_id,
      revision,
      reason:
        'The historical failed exact retest had no target revision binding and therefore cannot remain authoritative for invalidating implementation evidence.'
    }),
    recoveredAt
  );

  return {
    available: true,
    status: 'implementation_recovered',
    artifactId: artifact.artifact_id,
    failedRetestExecutionId:
      failedRetest.id,
    redteamRunId:
      redteamRun.id,
    revision
  };
}

async function resolveActiveRemediation({
  projectId,
  userId,
  systemSnapshotId,
  previousSystemSnapshotId = null
}) {
  let lineage =
    await resolveSnapshotBoundActiveRemediation({
      projectId,
      systemSnapshotId
    });

  if (
    !lineage.available &&
    lineage.reason ===
      'active_authoritative_remediation_not_found' &&
    previousSystemSnapshotId &&
    previousSystemSnapshotId !== systemSnapshotId
  ) {
    lineage =
      await resolveSnapshotBoundActiveRemediation({
        projectId,
        systemSnapshotId:
          previousSystemSnapshotId
      });

    if (lineage.available) {
      lineage = {
        ...lineage,
        inheritedFromSystemSnapshotId:
          previousSystemSnapshotId
      };
    }
  }

  if (!lineage.available) {
    return lineage;
  }

  const detail =
    await getControlIntelligenceControl({
      projectId,
      controlId: lineage.controlId,
      userId
    });

  const finding =
    (detail.findings || []).find(
      (item) => item?.id === lineage.findingId
    ) || null;

  if (!finding) {
    return {
      available: false,
      reason:
        'active_authoritative_remediation_not_found'
    };
  }

  return {
    available: true,
    controlId: lineage.controlId,
    finding,
    detail
  };
}

function publicArtifacts({
  assessmentContext,
  authoritativeAssessment,
  frozen,
  inspectorBindingVerified,
  controlId = null,
  controlStage = null,
  chainStatus = null,
  baselineRevision = null
}) {
  const currentRevision =
    frozen?.revision || null;

  return {
    frozenTarget: {
      available: Boolean(currentRevision),
      repositoryPath:
        frozen?.repositoryPath || null,
      revision: currentRevision,
      inspectorBindingVerified:
        inspectorBindingVerified === true
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
          currentRevision &&
          baselineRevision &&
          currentRevision === baselineRevision
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
      available: Boolean(controlId),
      systemSnapshotId:
        assessmentContext?.systemSnapshotId || null,
      relevantControls:
        controlId
          ? [
              {
                controlId,
                currentStage: controlStage,
                chainStatus,
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

function workflowState({
  stage,
  actionName,
  actor,
  reason,
  assessmentContext,
  authoritativeAssessment,
  frozen,
  inspectorBindingVerified = false,
  remediation = null,
  baselineRevision = null,
  blockerCode = null,
  securityStateChanged = false
}) {
  const requiresUserInput = actor !== 'arl';
  const controlId =
    remediation?.controlId || null;

  return {
    type: 'authoritative_workflow_state',
    schema: WORKFLOW_STATE_SCHEMA,
    available: true,
    stage,
    blocked: requiresUserInput,
    canAutoAdvance:
      actor === 'arl' && !requiresUserInput,
    blockers:
      blockerCode
        ? [
            {
              code: blockerCode,
              source: 'git_remediation_handoff',
              userActionRequired: true
            }
          ]
        : [],
    authoritativeArtifacts:
      publicArtifacts({
        assessmentContext,
        authoritativeAssessment,
        frozen,
        inspectorBindingVerified,
        controlId,
        controlStage:
          remediation?.detail?.chain?.currentStage ||
          'remediation',
        chainStatus:
          remediation?.detail?.chain?.chainStatus ||
          'remediation_in_progress',
        baselineRevision
      }),
    scopedControl:
      controlId
        ? {
            controlId,
            currentStage:
              remediation?.detail?.chain?.currentStage ||
              'remediation',
            chainStatus:
              remediation?.detail?.chain?.chainStatus ||
              'remediation_in_progress',
            nextAction:
              remediation?.detail?.chain?.nextAction || null,
            deploymentImpact: 'blocker'
          }
        : null,
    nextAllowedAction: {
      name: actionName,
      actor,
      requiresUserInput,
      reason,
      controlId,
      caseId: null
    },
    readiness: {
      available: false,
      decision: null,
      systemSnapshotId:
        assessmentContext?.systemSnapshotId || null,
      humanReviewRequired: true
    },
    remediationHandoff: {
      baselineRevision,
      currentRevision:
        frozen?.revision || null,
      implementationRecorded:
        stage === 'changed_system_snapshot_required'
    },
    securityStateChanged,
    deploymentDecisionWritten: false,
    humanReviewRequired: true
  };
}

function execution({
  status,
  reason,
  securityStateChanged
}) {
  const changed = securityStateChanged === true;

  return {
    type: 'remediation_execution',
    schema: REMEDIATION_EXECUTION_SCHEMA,
    status,
    reason,
    executedActionCount: changed ? 1 : 0,
    executedActions:
      changed
        ? [
            {
              action:
                'record_git_remediation_implementation',
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

function result({
  status,
  reason,
  state,
  securityStateChanged = false,
  extra = {}
}) {
  return {
    type: 'git_remediation_handoff',
    schema: GIT_REMEDIATION_HANDOFF_SCHEMA,
    available: true,
    status,
    reason,
    securityStateChanged,
    workflowState: state,
    execution: execution({
      status,
      reason,
      securityStateChanged
    }),
    deploymentDecisionWritten: false,
    humanReviewRequired: true,
    ...extra
  };
}

function unavailable(reason) {
  return {
    type: 'git_remediation_handoff',
    schema: GIT_REMEDIATION_HANDOFF_SCHEMA,
    available: false,
    reason,
    securityStateChanged: false,
    deploymentDecisionWritten: false,
    humanReviewRequired: true
  };
}

export async function captureGitRemediationHandoff({
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

  const previousSystemSnapshotId =
    clean(
      assessmentContext?.assessmentConfiguration
        ?.remediationSnapshotConfirmation
        ?.previousSystemSnapshotId
    ) || null;

  const remediation =
    await resolveActiveRemediation({
      projectId,
      userId,
      systemSnapshotId:
        assessmentContext.systemSnapshotId,
      previousSystemSnapshotId
    });

  const frozen =
    await freezeLocalRepository(repositoryPath);

  if (!remediation.available) {
    const ambiguous =
      remediation.reason ===
      'active_authoritative_remediation_ambiguous';

    const state = workflowState({
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
          ? 'More than one active authoritative remediation is bound to the current vulnerable system snapshot. ARL will not choose which finding the Git change remediates.'
          : 'No active authoritative remediation is bound to the current vulnerable system snapshot.',
      assessmentContext,
      authoritativeAssessment,
      frozen,
      baselineRevision,
      blockerCode: remediation.reason
    });

    return result({
      status:
        ambiguous
          ? 'human_review_required'
          : 'user_action_required',
      reason: remediation.reason,
      state,
      extra: {
        candidateCount:
          remediation.candidateCount || 0
      }
    });
  }

  const remediationState =
    remediation.detail?.chain?.remediationState || {};

  const implementationRecorded =
    remediationState.implementationRecorded === true;

  const remediatedSnapshotReady =
    remediationState.remediatedSnapshotReady === true;

  if (implementationRecorded) {
    const exactRetestReady =
      remediatedSnapshotReady === true;

    const state = workflowState({
      stage:
        exactRetestReady
          ? 'exact_retest_required'
          : 'changed_system_snapshot_required',
      actionName:
        exactRetestReady
          ? 'authorise_and_run_exact_retest'
          : 'capture_changed_system_snapshot',
      actor: 'user',
      reason:
        exactRetestReady
          ? 'Remediation implementation evidence and the changed authoritative system snapshot are already recorded. A revision-bound exact retest is required.'
          : 'Remediation implementation evidence is already recorded. A changed authoritative system snapshot is required before exact retest.',
      assessmentContext,
      authoritativeAssessment,
      frozen,
      remediation,
      baselineRevision,
      blockerCode:
        exactRetestReady
          ? 'revision_bound_exact_retest_required'
          : 'changed_system_snapshot_required'
    });

    return result({
      status:
        exactRetestReady
          ? 'already_recorded_exact_retest_required'
          : 'already_recorded',
      reason:
        exactRetestReady
          ? 'remediation_and_changed_snapshot_already_recorded'
          : 'remediation_implementation_already_recorded',
      state,
      extra: {
        findingId: remediation.finding.id,
        controlId: remediation.controlId,
        baselineRevision,
        currentRevision: frozen.revision,
        remediationState
      }
    });
  }

  if (frozen.dirty) {
    const state = workflowState({
      stage: 'remediation_worktree_clean_required',
      actionName:
        'commit_and_clean_remediation_worktree',
      actor: 'user',
      reason:
        'ARL requires a clean committed Git revision before it can register repository remediation as implementation evidence.',
      assessmentContext,
      authoritativeAssessment,
      frozen,
      remediation,
      baselineRevision,
      blockerCode: 'remediation_worktree_dirty'
    });

    return result({
      status: 'user_action_required',
      reason: 'remediation_worktree_dirty',
      state,
      extra: {
        findingId: remediation.finding.id,
        controlId: remediation.controlId,
        baselineRevision,
        currentRevision: frozen.revision
      }
    });
  }

  if (frozen.revision === baselineRevision) {
    const recovery =
      await recoverLegacyUnboundRetestImplementation({
        projectId,
        userId,
        findingId: remediation.finding.id,
        revision: frozen.revision
      });

    if (recovery.available === true) {
      const refreshed =
        await resolveActiveRemediation({
          projectId,
          userId,
          systemSnapshotId:
            assessmentContext.systemSnapshotId,
          previousSystemSnapshotId
        });

      const state = workflowState({
        stage: 'exact_retest_required',
        actionName: 'authorise_and_run_exact_retest',
        actor: 'user',
        reason:
          'ARL restored the existing remediation implementation evidence because the historical failed exact retest was not bound to a target revision. The finding remains open and a new revision-bound exact retest is required.',
        assessmentContext,
        authoritativeAssessment,
        frozen,
        remediation:
          refreshed.available === true
            ? refreshed
            : remediation,
        baselineRevision,
        blockerCode: 'revision_bound_exact_retest_required',
        securityStateChanged: true
      });

      return result({
        status:
          'implementation_recovered_for_revision_bound_retest',
        reason:
          'legacy_unbound_failed_retest_recovery',
        state,
        securityStateChanged: true,
        extra: {
          findingId: remediation.finding.id,
          controlId: remediation.controlId,
          baselineRevision,
          currentRevision: frozen.revision,
          recoveredImplementationArtifactId:
            recovery.artifactId,
          historicalFailedRetestExecutionId:
            recovery.failedRetestExecutionId,
          historicalRedTeamRunId:
            recovery.redteamRunId
        }
      });
    }

    const state = workflowState({
      stage: 'remediation_change_required',
      actionName: 'commit_remediation_change',
      actor: 'user',
      reason:
        'The repository is clean but still at the revision bound to the failed snapshot. ARL will not record the statement “I fixed it” as implementation evidence unless the previous failed retest is provably legacy and unbound to the target revision.',
      assessmentContext,
      authoritativeAssessment,
      frozen,
      remediation,
      baselineRevision,
      blockerCode: 'repository_revision_unchanged'
    });

    return result({
      status: 'user_action_required',
      reason: 'repository_revision_unchanged',
      state,
      extra: {
        findingId: remediation.finding.id,
        controlId: remediation.controlId,
        baselineRevision,
        currentRevision: frozen.revision,
        recoveryReason:
          recovery.reason || null
      }
    });
  }

  const inspected =
    await inspectFrozenRepository(repositoryPath);

  const repositoryName =
    path.basename(inspected.target.repositoryPath);

  const sourceSnapshot =
    await recordAssetSnapshot({
      projectId,
      userId,
      source: 'arl-agent-git-remediation',
      documents: {
        remediationTarget: {
          kind: 'agent',
          provider: 'other',
          name:
            `${repositoryName}@${inspected.target.revision}`,
          environment: 'unknown',
          git: {
            baselineRevision,
            currentRevision:
              inspected.target.revision,
            source: 'local_git'
          }
        }
      }
    });

  const implementation =
    await recordAuthoritativeRemediationImplementation({
      projectId,
      userId,
      findingId: remediation.finding.id,
      sourceId: sourceSnapshot.id
    });

  if (!implementation.available) {
    return unavailable(
      implementation.reason ||
      'remediation_implementation_recording_failed'
    );
  }

  const state = workflowState({
    stage: 'changed_system_snapshot_required',
    actionName: 'capture_changed_system_snapshot',
    actor: 'user',
    reason:
      'ARL verified a clean changed Git revision and recorded it as remediation implementation evidence. A changed authoritative system snapshot is now required before exact retest.',
    assessmentContext,
    authoritativeAssessment,
    frozen: inspected.target,
    inspectorBindingVerified:
      inspected.binding?.verified === true,
    remediation,
    baselineRevision,
    blockerCode: 'changed_system_snapshot_required',
    securityStateChanged: true
  });

  return result({
    status: 'implementation_recorded',
    reason: 'git_remediation_implementation_recorded',
    state,
    securityStateChanged: true,
    extra: {
      findingId: remediation.finding.id,
      controlId: remediation.controlId,
      baselineRevision,
      currentRevision:
        inspected.target.revision,
      sourceSnapshotId: sourceSnapshot.id,
      implementationArtifactId:
        implementation.artifactId
    }
  });
}
