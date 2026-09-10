import {
  recordAssetSnapshot
} from '../control-plane.js';

import {
  normaliseFrozenInspectionTransport
} from './frozen-inspection-transport.mjs';

import {
  resolveSnapshotBoundActiveRemediation
} from './active-remediation-lineage.mjs';

import {
  recordAuthoritativeRemediationImplementation
} from './tools/record-authoritative-remediation-implementation.mjs';

export const HOSTED_REMEDIATION_HANDOFF_SCHEMA =
  'arl.agent.hosted-remediation-handoff.v1';

function unavailable(reason) {
  return {
    type: 'hosted_remediation_handoff',
    schema: HOSTED_REMEDIATION_HANDOFF_SCHEMA,
    available: false,
    reason,
    securityStateChanged: false,
    deploymentDecisionWritten: false,
    humanReviewRequired: true
  };
}

function remediationContext(
  workflowState,
  {
    requireSystemSnapshot = false
  } = {}
) {
  if (
    workflowState?.schema !==
    'arl.agent.workflow-state.v1'
  ) {
    return {
      available: false,
      reason: 'authoritative_workflow_state_required'
    };
  }

  if (
    workflowState.stage !== 'remediation_required' &&
    workflowState.stage !==
      'changed_system_snapshot_required'
  ) {
    return {
      available: false,
      reason: 'authoritative_remediation_gate_required'
    };
  }

  const controlId =
    workflowState.scopedControl?.controlId || null;

  const baselineRevision =
    workflowState.authoritativeArtifacts
      ?.frozenTarget?.revision || null;

  const systemSnapshotId =
    workflowState.authoritativeArtifacts
      ?.assessmentContext?.systemSnapshotId || null;

  if (
    !controlId ||
    !baselineRevision ||
    (
      requireSystemSnapshot &&
      !systemSnapshotId
    )
  ) {
    return {
      available: false,
      reason: 'authoritative_remediation_context_required'
    };
  }

  return {
    available: true,
    controlId,
    baselineRevision,
    systemSnapshotId
  };
}

export async function prepareHostedRemediationHandoff({
  workflowState
} = {}) {
  const context = remediationContext(workflowState);

  if (!context.available) {
    return unavailable(context.reason);
  }

  if (workflowState.stage !== 'remediation_required') {
    return unavailable(
      'authoritative_remediation_gate_required'
    );
  }

  return {
    type: 'hosted_remediation_handoff',
    schema: HOSTED_REMEDIATION_HANDOFF_SCHEMA,
    available: true,
    status:
      'local_remediation_verification_required',
    controlId: context.controlId,
    baselineRevision: context.baselineRevision,
    requirements: {
      cleanCommittedRevision: true,
      changedFromBaseline: true,
      frozenInspectionRequired: true
    },
    securityStateChanged: false,
    deploymentDecisionWritten: false,
    humanReviewRequired: true
  };
}

export async function completeHostedRemediationHandoff({
  workflowState,
  projectId,
  userId,
  frozenInspection
} = {}) {
  const context = remediationContext(
    workflowState,
    {
      requireSystemSnapshot: true
    }
  );

  if (!context.available) {
    return unavailable(context.reason);
  }

  if (!projectId || !userId) {
    return unavailable(
      'authoritative_operator_context_required'
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
      'frozen_inspection_transport_invalid'
    );
  }

  const currentRevision =
    frozen.target.revision;

  if (
    currentRevision === context.baselineRevision
  ) {
    return unavailable(
      'repository_revision_unchanged'
    );
  }

  const lineage =
    await resolveSnapshotBoundActiveRemediation({
      projectId,
      systemSnapshotId: context.systemSnapshotId
    });

  if (!lineage.available) {
    return unavailable(lineage.reason);
  }

  if (lineage.controlId !== context.controlId) {
    return unavailable(
      'authoritative_remediation_lineage_mismatch'
    );
  }

  /*
   * Replay after authoritative implementation evidence
   * has already been recorded must not create another
   * snapshot or another evidence artifact.
   */
  if (lineage.findingStatus === 'evidence_attached') {
    return {
      type: 'hosted_remediation_handoff',
      schema: HOSTED_REMEDIATION_HANDOFF_SCHEMA,
      available: true,
      status: 'already_recorded',
      controlId: context.controlId,
      baselineRevision: context.baselineRevision,
      currentRevision,
      nextStage:
        'changed_system_snapshot_required',
      securityStateChanged: false,
      deploymentDecisionWritten: false,
      humanReviewRequired: true
    };
  }

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
            `hosted-remediation@${currentRevision}`,
          environment: 'unknown',
          git: {
            baselineRevision:
              context.baselineRevision,
            currentRevision,
            source: 'local_git'
          }
        }
      }
    });

  const implementation =
    await recordAuthoritativeRemediationImplementation({
      projectId,
      userId,
      findingId: lineage.findingId,
      sourceId: sourceSnapshot.id
    });

  if (!implementation.available) {
    return unavailable(
      implementation.reason ||
      'remediation_implementation_recording_failed'
    );
  }

  return {
    type: 'hosted_remediation_handoff',
    schema: HOSTED_REMEDIATION_HANDOFF_SCHEMA,
    available: true,
    status: 'implementation_recorded',
    controlId: context.controlId,
    baselineRevision: context.baselineRevision,
    currentRevision,
    nextStage:
      'changed_system_snapshot_required',
    securityStateChanged: true,
    deploymentDecisionWritten: false,
    humanReviewRequired: true,
    internal: {
      findingId: lineage.findingId,
      sourceSnapshotId: sourceSnapshot.id,
      implementationArtifactId:
        implementation.artifactId
    }
  };
}
