import {
  recordControlTestExecution
} from '../../control-intelligence.js';

import {
  db,
  id,
  nowIso
} from '../../db.js';

import {
  canonicalJson,
  intelligenceDigest
} from '../../control-intelligence-core.js';

import {
  REDTEAM_INITIAL_VERIFICATION_SCOPE,
  REDTEAM_TRUST_BOUNDARY
} from '../../control-redteam-evidence.js';

import {
  getAssessmentControlBinding
} from '../assessment-control-bindings.mjs';

import {
  recordAuthoritativeControlEvidence
} from './record-authoritative-control-evidence.mjs';

export async function promoteInitialRedTeamEvidence({
  evidence,
  projectId,
  userId,
  assessmentContext,
  redTeamOutcome
}) {
  if (
    !evidence?.evidenceId ||
    !redTeamOutcome?.runId ||
    !redTeamOutcome?.caseId ||
    !redTeamOutcome?.bundleDigest
  ) {
    throw new Error(
      'Initial Red Team evidence promotion requires evidence, run, case and bundle identities.'
    );
  }

  const expectedRevision =
    String(
      assessmentContext
        ?.assessmentConfiguration
        ?.targetBinding
        ?.revision || ''
    )
      .trim()
      .toLowerCase();

  const observedRevision =
    String(
      redTeamOutcome
        ?.campaign
        ?.target
        ?.revision || ''
    )
      .trim()
      .toLowerCase();

  if (
    !expectedRevision ||
    !observedRevision ||
    expectedRevision !== observedRevision
  ) {
    throw new Error(
      'Initial Red Team evidence target revision does not match the authoritative current snapshot binding.'
    );
  }

  const row =
    await db.prepare(`
      SELECT
        workspace_id,
        descriptor_json,
        integrity_digest,
        verification_state
      FROM control_evidence_items
      WHERE id = ?
        AND project_id = ?
    `).get(
      evidence.evidenceId,
      projectId
    );

  if (!row) {
    throw new Error(
      'Initial Red Team evidence row was not found.'
    );
  }

  if (row.verification_state === 'verified') {
    return {
      ...evidence,
      verificationState: 'verified'
    };
  }

  if (row.verification_state !== 'unverified') {
    throw new Error(
      'Initial Red Team evidence trust promotion precondition failed.'
    );
  }

  const previous =
    JSON.parse(row.descriptor_json || '{}');

  if (
    intelligenceDigest(previous) !==
    row.integrity_digest
  ) {
    throw new Error(
      'Initial Red Team evidence integrity verification failed.'
    );
  }

  const timestamp = nowIso();

  const descriptor = {
    ...previous,
    sourceDigest:
      redTeamOutcome.bundleDigest,
    verificationState:
      'verified',
    verificationScope:
      REDTEAM_INITIAL_VERIFICATION_SCOPE,
    trustBoundary:
      redTeamOutcome.trustBoundary ||
      REDTEAM_TRUST_BOUNDARY,
    redteamRunId:
      redTeamOutcome.runId,
    redteamCaseId:
      redTeamOutcome.caseId,
    targetRevision:
      observedRevision
  };

  const nextDigest =
    intelligenceDigest(descriptor);

  const reason =
    'Integrity-verified customer-operated bounded Red Team result bound to the exact current target revision and system snapshot.';

  const trust = {
    schema:
      'arl.control-evidence-trust-revision.v1',
    evidenceId:
      evidence.evidenceId,
    previousVerificationState:
      'unverified',
    newVerificationState:
      'verified',
    reason,
    bundleDigest:
      redTeamOutcome.bundleDigest,
    targetRevision:
      observedRevision,
    controlId:
      evidence.controlId,
    actorId:
      userId,
    createdAt:
      timestamp
  };

  await db.transaction(async () => {
    const result =
      await db.prepare(`
        UPDATE control_evidence_items
        SET
          verification_state = 'verified',
          descriptor_json = ?,
          integrity_digest = ?,
          redteam_run_id = ?,
          redteam_case_id = ?
        WHERE id = ?
          AND project_id = ?
          AND verification_state = 'unverified'
      `).run(
        canonicalJson(descriptor),
        nextDigest,
        redTeamOutcome.runId,
        redTeamOutcome.caseId,
        evidence.evidenceId,
        projectId
      );

    if (result.changes !== 1) {
      throw new Error(
        'Initial Red Team evidence trust promotion did not update exactly one row.'
      );
    }

    await db.prepare(`
      INSERT INTO control_evidence_trust_revisions
      (
        id,
        workspace_id,
        project_id,
        evidence_id,
        replacement_evidence_id,
        previous_verification_state,
        new_verification_state,
        reason,
        previous_descriptor_json,
        previous_integrity_digest,
        revision_digest,
        actor_id,
        created_at
      )
      VALUES (
        ?, ?, ?, ?, NULL,
        ?, ?, ?, ?, ?, ?, ?, ?
      )
    `).run(
      id('ctr_'),
      row.workspace_id,
      projectId,
      evidence.evidenceId,
      'unverified',
      'verified',
      reason,
      row.descriptor_json,
      row.integrity_digest,
      intelligenceDigest(trust),
      userId,
      timestamp
    );
  });

  return {
    ...evidence,
    verificationState:
      'verified',
    integrityDigest:
      nextDigest,
    sourceDigest:
      redTeamOutcome.bundleDigest,
    redteamRunId:
      redTeamOutcome.runId,
    redteamCaseId:
      redTeamOutcome.caseId
  };
}

export async function recordAuthoritativeRedTeamEvidence({
  projectId,
  userId,
  assessmentContext,
  assessmentWorkflow,
  evidencePlan,
  redTeamOutcome
} = {}) {
  if (!redTeamOutcome?.available) {
    return {
      type: 'authoritative_redteam_evidence',
      available: false,
      reason: 'authoritative_redteam_outcome_required'
    };
  }

  if (
    redTeamOutcome.signatureValid !== true ||
    redTeamOutcome.targetEvidence !== true ||
    !redTeamOutcome.bundleDigest
  ) {
    return {
      type: 'authoritative_redteam_evidence',
      available: false,
      reason: 'qualifying_redteam_target_evidence_required',
      runId: redTeamOutcome.runId || null,
      caseId: redTeamOutcome.caseId || null
    };
  }

  if (
    !assessmentWorkflow ||
    assessmentWorkflow.canContinue !== true
  ) {
    return {
      type: 'authoritative_redteam_evidence',
      available: false,
      reason: 'assessment_workflow_not_ready'
    };
  }

  const questionId =
    redTeamOutcome.questionId;

  const binding =
    getAssessmentControlBinding(
      questionId
    );

  if (!binding.available) {
    return {
      type: 'authoritative_redteam_evidence',
      available: false,
      reason: binding.reason,
      questionId
    };
  }

  if (
    !assessmentContext?.available ||
    !assessmentContext.systemSnapshotId
  ) {
    return {
      type: 'authoritative_redteam_evidence',
      available: false,
      reason: 'authoritative_system_snapshot_required'
    };
  }

  const passed =
    redTeamOutcome.status === 'passed';

  const failed =
    redTeamOutcome.status === 'failed';

  if (!passed && !failed) {
    return {
      type: 'authoritative_redteam_evidence',
      available: false,
      reason: 'redteam_outcome_unresolved'
    };
  }

  const execution =
    await recordControlTestExecution({
      projectId,
      controlId:
        binding.controlId,
      userId,

      input: {
        systemSnapshotId:
          assessmentContext.systemSnapshotId,

        result:
          passed ? 'passed' : 'failed',

        executionMethod:
          'bounded_redteam',

        inputReference:
          `${redTeamOutcome.caseId}:${redTeamOutcome.bundleDigest}`,

        expectedResult:
          'The bounded adversarial case is denied before unauthorised execution or side effect.',

        observedResult:
          passed
            ? 'The bounded adversarial case was denied within the tested scope.'
            : 'The bounded adversarial case produced a confirmed policy failure within the tested scope.',

        limitations:
          redTeamOutcome.trustBoundary ||
          'Customer-operated bounded Red Team evidence. This result applies only to the exact tested case, target version, snapshot and authorised scope.',

        failureReason:
          failed
            ? `Confirmed bounded Red Team failure: ${redTeamOutcome.caseId}`
            : ''
      }
    });

  const evidence =
    await recordAuthoritativeControlEvidence({
      projectId,
      userId,

      assessmentContext,
      assessmentWorkflow,
      evidencePlan,

      questionId,

      sourceType:
        'redteam_run',

      sourceReference:
        `redteam:${redTeamOutcome.runId}:${redTeamOutcome.caseId}:${redTeamOutcome.bundleDigest}`,

      testExecutionId:
        execution.id,

      limitations:
        'Integrity-verified customer-operated Red Team result linked to the exact bounded test execution. It does not prove absence of other attack paths.'
    });

  if (!evidence?.available) {
    return {
      type: 'authoritative_redteam_evidence',
      available: false,
      reason: evidence?.reason || 'control_evidence_recording_failed',
      runId: redTeamOutcome.runId,
      caseId: redTeamOutcome.caseId,
      questionId,
      controlId: binding.controlId,
      testExecutionId: execution.id
    };
  }

  const verifiedEvidence =
    await promoteInitialRedTeamEvidence({
      evidence,
      projectId,
      userId,
      assessmentContext,
      redTeamOutcome
    });

  return {
    type: 'authoritative_redteam_evidence',
    available: true,

    runId:
      redTeamOutcome.runId,

    caseId:
      redTeamOutcome.caseId,

    questionId,

    controlId:
      binding.controlId,

    result:
      passed ? 'passed' : 'failed',

    testExecutionId:
      execution.id,

    evidenceId:
      verifiedEvidence.evidenceId,

    verificationState:
      verifiedEvidence.verificationState,

    integrityDigest:
      verifiedEvidence.integrityDigest,

    bundleDigest:
      redTeamOutcome.bundleDigest,

    evidenceClass:
      redTeamOutcome.evidenceClass || null,

    findingRequired:
      failed
  };
}
