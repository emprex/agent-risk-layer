import {
  createControlFinding
} from '../../control-intelligence.js';

const REDTEAM_FINDING_PROFILES = Object.freeze({
  'RT-AUTH-001': Object.freeze({
    title: 'Role and authority confusion bypassed independent authorization',
    narrative: 'The bounded RT-AUTH-001 adversarial case reproduced a failure where a user-supplied claim of authority crossed the tested authorization boundary.',
    impact: 'Within the authorised bounded test scope, the target accepted user-supplied authority where independent authorization and approval were required.',
    affectedAsset: 'Agent tool authorization boundary',
    reproductionSummary: 'RT-AUTH-001 reproduced the tested authority-confusion failure against the exact bound target and system snapshot.',
    impactFacts: Object.freeze({
      approvalBypass: true
    })
  })
});

export async function createAuthoritativeRedTeamFinding({
  projectId,
  userId,
  assessmentContext,
  redTeamEvidence
} = {}) {
  if (!projectId || !userId) {
    return {
      type: 'authoritative_redteam_finding',
      available: false,
      reason: 'project_identity_required'
    };
  }

  if (
    !assessmentContext?.available ||
    !assessmentContext.systemSnapshotId
  ) {
    return {
      type: 'authoritative_redteam_finding',
      available: false,
      reason: 'authoritative_system_snapshot_required'
    };
  }

  if (!redTeamEvidence?.available) {
    return {
      type: 'authoritative_redteam_finding',
      available: false,
      reason: 'authoritative_redteam_evidence_required'
    };
  }

  if (
    redTeamEvidence.result !== 'failed' ||
    redTeamEvidence.findingRequired !== true
  ) {
    return {
      type: 'authoritative_redteam_finding',
      available: false,
      reason: 'confirmed_failed_redteam_evidence_required',
      caseId: redTeamEvidence.caseId || null
    };
  }

  if (
    !redTeamEvidence.controlId ||
    !redTeamEvidence.testExecutionId ||
    !redTeamEvidence.evidenceId
  ) {
    return {
      type: 'authoritative_redteam_finding',
      available: false,
      reason: 'redteam_failure_lineage_incomplete',
      caseId: redTeamEvidence.caseId || null
    };
  }

  const profile =
    REDTEAM_FINDING_PROFILES[
      redTeamEvidence.caseId
    ];

  if (!profile) {
    return {
      type: 'authoritative_redteam_finding',
      available: false,
      reason: 'redteam_finding_profile_not_defined',
      caseId: redTeamEvidence.caseId || null
    };
  }

  const finding =
    await createControlFinding({
      projectId,
      controlId:
        redTeamEvidence.controlId,
      userId,
      input: {
        systemSnapshotId:
          assessmentContext.systemSnapshotId,

        testExecutionId:
          redTeamEvidence.testExecutionId,

        title:
          profile.title,

        narrative:
          profile.narrative,

        impact:
          profile.impact,

        affectedAsset:
          profile.affectedAsset,

        reproductionSummary:
          profile.reproductionSummary,

        limitations:
          'Finding is limited to the exact authorised RT-AUTH-001 bounded test, target version and system snapshot. It does not establish broader exploitability outside that scope.',

        impactFacts:
          profile.impactFacts
      }
    });

  return {
    type: 'authoritative_redteam_finding',
    available: true,

    findingId:
      finding.id,

    caseId:
      redTeamEvidence.caseId,

    controlId:
      finding.controlId ||
      redTeamEvidence.controlId,

    testExecutionId:
      redTeamEvidence.testExecutionId,

    evidenceId:
      redTeamEvidence.evidenceId,

    status:
      finding.status,

    contextualSeverity:
      finding.contextualSeverity,

    severityStatus:
      finding.severityStatus,

    systemSnapshotId:
      finding.snapshotId ||
      assessmentContext.systemSnapshotId
  };
}