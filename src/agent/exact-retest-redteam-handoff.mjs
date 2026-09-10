import crypto from 'node:crypto';

import {
  createRedTeamToken,
  consumeRedTeamUpload,
  listRedTeamAuthorisations,
  listRedTeamRunsForAssessment
} from '../redteam.js';

import {
  getControlIntelligenceControl
} from '../control-intelligence.js';

import {
  runCampaign
} from '../../redteam/agent-risk-redteam.mjs';

import {
  getAuthoritativeRedTeamOutcome
} from './tools/get-authoritative-redteam-outcome.mjs';

import {
  getAuthoritativeRedTeamLineage
} from './tools/get-authoritative-redteam-lineage.mjs';

import {
  resolvePersistedExactRetestContinuation
} from './tools/resolve-persisted-exact-retest-continuation.mjs';

export const EXACT_RETEST_REDTEAM_HANDOFF_SCHEMA =
  'arl.agent.exact-retest-redteam-handoff.v1';

export const EXACT_RETEST_REDTEAM_EXECUTION_SCHEMA =
  'arl.agent.exact-retest-redteam-execution.v1';

const ADAPTER_PATH = '/agentrisklayer/evaluate';

function normalise(text) {
  return String(text || '')
    .trim()
    .toLowerCase()
    .replace(/[—–]/g, '-')
    .replace(/\s+/g, ' ');
}

function clean(value) {
  return String(value ?? '').trim();
}

function sha256(value) {
  return crypto
    .createHash('sha256')
    .update(String(value))
    .digest('hex');
}

export function detectExactRetestExecutionCommand(userRequest) {
  const text = normalise(userRequest);

  if (!text) {
    return null;
  }

  if (
    /^run (?:the )?exact retest[.!?]*$/.test(text) ||
    /^(?:authorise|authorize)(?: and)? run (?:the )?exact retest[.!?]*$/.test(text) ||
    /^i (?:authorise|authorize) (?:the )?exact retest[.!?]*$/.test(text)
  ) {
    return 'exact_retest_execute';
  }

  return null;
}

function execution({
  changed = false,
  status = 'blocked'
} = {}) {
  return {
    type: 'exact_retest_redteam_execution',
    schema: EXACT_RETEST_REDTEAM_EXECUTION_SCHEMA,
    status,
    executedActionCount: changed ? 1 : 0,
    executedActions:
      changed
        ? [
            {
              action: 'execute_authorised_exact_redteam_retest',
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

function blocked(reason, extra = {}) {
  return {
    type: 'exact_retest_redteam_handoff',
    schema: EXACT_RETEST_REDTEAM_HANDOFF_SCHEMA,
    available: false,
    status: 'blocked',
    reason,
    securityStateChanged: false,
    execution: execution(),
    deploymentDecisionWritten: false,
    humanReviewRequired: true,
    ...extra
  };
}

function persistedUnresolved(reason, persisted, extra = {}) {
  return {
    type: 'exact_retest_redteam_handoff',
    schema: EXACT_RETEST_REDTEAM_HANDOFF_SCHEMA,
    available: false,
    status: 'retest_persisted_unresolved',
    reason,
    persisted: true,
    persistedRunId: persisted?.runId || null,
    securityStateChanged: true,
    execution: execution({
      changed: true,
      status: 'retest_persisted_unresolved'
    }),
    deploymentDecisionWritten: false,
    humanReviewRequired: true,
    ...extra
  };
}

function exactPlanMapping(workflowState) {
  const mappings =
    workflowState?.authoritativeArtifacts
      ?.evidencePlan?.mappedControls;

  if (!Array.isArray(mappings)) {
    return null;
  }

  const valid = mappings.filter(
    (item) => item?.controlId && item?.caseId
  );
  const scopedControlId =
    workflowState?.scopedControl?.controlId || null;
  const scoped = scopedControlId
    ? valid.filter(
        (item) => item.controlId === scopedControlId
      )
    : valid;

  return scoped.length === 1
    ? scoped[0]
    : null;
}

function evidencePlanFromState(workflowState) {
  const projected =
    workflowState?.authoritativeArtifacts?.evidencePlan;

  if (projected?.available !== true) {
    return null;
  }

  const mapped =
    Array.isArray(projected.mappedControls)
      ? projected.mappedControls
      : [];

  return {
    type: 'evidence_plan',
    available: true,
    state: projected.state || null,
    checks: mapped
      .filter((item) => item?.caseId)
      .map((item) => ({
        id: item.planId || null,
        caseId: item.caseId,
        gap: {
          questionId: item.questionId || null
        }
      })),
    manual: []
  };
}

function activeSafeAuthorisation(authorisation, nowMs) {
  const start = Date.parse(authorisation?.windowStart || '');
  const end = Date.parse(authorisation?.windowEnd || '');

  return Boolean(
    authorisation?.status === 'active' &&
    ['local', 'test', 'staging'].includes(
      authorisation?.environment
    ) &&
    authorisation?.syntheticDataOnly === true &&
    authorisation?.dryRunToolsOnly === true &&
    Number.isFinite(start) &&
    Number.isFinite(end) &&
    start <= nowMs &&
    end > nowMs
  );
}

function adapterEndpoint(origin) {
  try {
    return new URL(ADAPTER_PATH, origin).toString();
  } catch {
    return null;
  }
}

async function uniqueOpenFailedBaseline({
  projectId,
  userId,
  assessmentId,
  evidencePlan,
  caseId,
  controlId
}) {
  const runs =
    await listRedTeamRunsForAssessment({
      assessmentId,
      userId
    });
  const candidates = [];

  for (const run of runs) {
    const outcome =
      await getAuthoritativeRedTeamOutcome({
        runId: run.id,
        userId,
        assessmentId,
        evidencePlan,
        caseId
      });

    if (
      outcome.available !== true ||
      outcome.status !== 'failed'
    ) {
      continue;
    }

    const lineage =
      await getAuthoritativeRedTeamLineage({
        projectId,
        userId,
        assessmentId,
        evidencePlan,
        runId: run.id,
        caseId
      });

    if (
      lineage.available === true &&
      lineage.controlId === controlId &&
      lineage.findingId &&
      !['verified_closed', 'accepted_risk'].includes(
        lineage.findingStatus
      )
    ) {
      candidates.push({
        runId: run.id,
        outcome,
        lineage
      });
    }
  }

  if (candidates.length !== 1) {
    return {
      available: false,
      reason:
        candidates.length === 0
          ? 'exact_retest_failed_baseline_not_found'
          : 'exact_retest_failed_baseline_ambiguous',
      candidateCount: candidates.length
    };
  }

  return {
    available: true,
    ...candidates[0]
  };
}

export const EXACT_RETEST_REDTEAM_RESERVATION_SCHEMA =
  'arl.agent.exact-retest-redteam-reservation.v1';

export async function prepareExactRetestRedTeamReservation({
  workflowState,
  projectId,
  userId,
  assessmentId
} = {}) {
  if (!projectId || !userId || !assessmentId) {
    return blocked(
      'authoritative_exact_retest_identity_required'
    );
  }

  const action = workflowState?.nextAllowedAction || null;

  if (
    workflowState?.stage !== 'exact_retest_required' ||
    action?.actor !== 'user' ||
    action?.requiresUserInput !== true
  ) {
    return blocked(
      'authoritative_exact_retest_gate_required'
    );
  }

  const evidencePlan =
    evidencePlanFromState(workflowState);
  const mapping =
    exactPlanMapping(workflowState);

  if (!evidencePlan || !mapping) {
    return blocked(
      'exact_retest_evidence_plan_mapping_ambiguous'
    );
  }

  const expectedSnapshotId =
    workflowState?.authoritativeArtifacts
      ?.assessmentContext?.systemSnapshotId || null;

  const detail =
    await getControlIntelligenceControl({
      projectId,
      controlId: mapping.controlId,
      userId
    });

  if (
    !expectedSnapshotId ||
    detail?.systemSnapshot?.id !== expectedSnapshotId ||
    detail?.chain?.currentStage !== 'retest'
  ) {
    return blocked(
      'exact_retest_control_authority_required'
    );
  }

  let baseline;

  try {
    baseline =
      await uniqueOpenFailedBaseline({
        projectId,
        userId,
        assessmentId,
        evidencePlan,
        caseId: mapping.caseId,
        controlId: mapping.controlId
      });
  } catch (error) {
    return blocked(
      `exact_retest_baseline_resolution_failed:${clean(
        error?.message || 'unknown'
      )}`
    );
  }

  if (baseline.available !== true) {
    return blocked(
      baseline.reason,
      {
        candidateCount:
          baseline.candidateCount || 0
      }
    );
  }

  const baselineTarget =
    baseline.outcome?.campaign?.target || {};

  const baselineEnvironment =
    clean(
      baseline.outcome?.campaign?.environment
    );

  const authorisationId =
    clean(
      baseline.outcome?.authorisationId
    );

  if (
    baselineTarget.mode !== 'staging-adapter' ||
    !authorisationId
  ) {
    return blocked(
      'exact_retest_baseline_target_authority_required'
    );
  }

  let authorisations;

  try {
    authorisations =
      await listRedTeamAuthorisations({
        assessmentId,
        userId
      });
  } catch (error) {
    return blocked(
      `exact_retest_authorisation_lookup_failed:${clean(
        error?.message || 'unknown'
      )}`
    );
  }

  const matches =
    authorisations.filter(
      (item) => item?.id === authorisationId
    );

  if (matches.length !== 1) {
    return blocked(
      'exact_retest_rules_of_engagement_missing'
    );
  }

  const authorisation = matches[0];

  if (
    !activeSafeAuthorisation(
      authorisation,
      Date.now()
    )
  ) {
    return blocked(
      'exact_retest_rules_of_engagement_not_active'
    );
  }

  const endpoint =
    adapterEndpoint(
      authorisation.endpointOrigin
    );

  if (!endpoint) {
    return blocked(
      'exact_retest_adapter_endpoint_invalid'
    );
  }

  const expectedPathHash =
    sha256(ADAPTER_PATH);

  if (
    authorisation.environment !==
      baselineEnvironment ||
    authorisation.endpointOrigin !==
      baselineTarget.endpointOrigin ||
    baselineTarget.endpointPathHash !==
      expectedPathHash
  ) {
    return blocked(
      'exact_retest_target_or_authorisation_changed'
    );
  }

  let reservation;

  try {
    reservation =
      await createRedTeamToken({
        userId,
        assessmentId,
        mode: 'staging',
        authorisationId
      });
  } catch (error) {
    return blocked(
      `exact_retest_reservation_failed:${clean(
        error?.message || 'unknown'
      )}`
    );
  }

  return {
    type: 'exact_retest_redteam_reservation',
    schema:
      EXACT_RETEST_REDTEAM_RESERVATION_SCHEMA,
    available: true,
    status: 'exact_retest_reserved',
    reason:
      'authorised_exact_retest_reserved',
    reservationToken:
      reservation.token,
    expiresAt:
      reservation.expiresAt,
    executionPlan: {
      environment:
        authorisation.environment,
      endpoint,
      authorisationId,
      caseId:
        mapping.caseId,
      trials: 1,
      adaptiveRounds: 1,
      mutate: false
    },
    continuationContext: {
      projectId,
      userId,
      assessmentId,
      evidencePlan,
      caseId:
        mapping.caseId,
      controlId:
        mapping.controlId
    },
    securityStateChanged: false,
    deploymentDecisionWritten: false,
    humanReviewRequired: true
  };
}

export async function persistExactRetestRedTeamReservation({
  reservationToken,
  bundle,
  continuationContext
} = {}) {
  if (
    !reservationToken ||
    !continuationContext?.projectId ||
    !continuationContext?.userId ||
    !continuationContext?.assessmentId ||
    !continuationContext?.caseId ||
    !continuationContext?.controlId ||
    !continuationContext?.evidencePlan
  ) {
    return blocked(
      'exact_retest_reservation_context_required'
    );
  }

  let persisted;

  try {
    persisted =
      await consumeRedTeamUpload({
        rawToken: reservationToken,
        bundle
      });
  } catch (error) {
    return blocked(
      `exact_retest_persistence_failed:${clean(
        error?.message || 'unknown'
      )}`
    );
  }

  const failed = Number(
    persisted?.summary?.counts?.failed || 0
  );

  const passed = Number(
    persisted?.summary?.counts?.passed || 0
  );

  if (failed > 0 || passed !== 1) {
    return {
      type: 'exact_retest_redteam_handoff',
      schema:
        EXACT_RETEST_REDTEAM_HANDOFF_SCHEMA,
      available: true,
      status:
        'exact_retest_failed_persisted',
      reason:
        'authorised_exact_retest_did_not_pass',
      persisted: true,
      persistedRunId:
        persisted?.runId || null,
      exactRetestReady: false,
      securityStateChanged: true,
      execution: execution({
        changed: true,
        status:
          'exact_retest_failed_persisted'
      }),
      deploymentDecisionWritten: false,
      humanReviewRequired: true
    };
  }

  const continuation =
    await resolvePersistedExactRetestContinuation({
      projectId:
        continuationContext.projectId,
      userId:
        continuationContext.userId,
      assessmentId:
        continuationContext.assessmentId,
      evidencePlan:
        continuationContext.evidencePlan,
      caseId:
        continuationContext.caseId,
      controlId:
        continuationContext.controlId
    });

  if (
    continuation.available !== true ||
    continuation.retestRunId !==
      persisted?.runId
  ) {
    return persistedUnresolved(
      continuation.reason ||
        'persisted_exact_retest_lineage_unresolved',
      persisted,
      {
        candidateCount:
          continuation.candidateCount || 0
      }
    );
  }

  return {
    type: 'exact_retest_redteam_handoff',
    schema:
      EXACT_RETEST_REDTEAM_HANDOFF_SCHEMA,
    available: true,
    status: 'exact_retest_persisted',
    reason:
      'authorised_exact_retest_persisted',
    persisted: true,
    persistedRunId:
      persisted.runId,
    exactRetestReady: true,
    continuation: {
      selectionBasis:
        continuation.selectionBasis,
      caseId:
        continuation.caseId,
      controlId:
        continuation.controlId,
      findingStatus:
        continuation.findingStatus
    },
    securityStateChanged: true,
    execution: execution({
      changed: true,
      status: 'exact_retest_persisted'
    }),
    deploymentDecisionWritten: false,
    humanReviewRequired: true
  };
}

export async function executeExactRetestRedTeamHandoff({
  workflowState,
  projectId,
  userId,
  assessmentId,
  targetToken =
    process.env.ARL_TARGET_TOKEN || ''
} = {}) {
  const authToken =
    clean(targetToken);

  if (!authToken) {
    return blocked(
      'exact_retest_adapter_credential_required'
    );
  }

  const reservation =
    await prepareExactRetestRedTeamReservation({
      workflowState,
      projectId,
      userId,
      assessmentId
    });

  if (reservation.available !== true) {
    return reservation;
  }

  const plan =
    reservation.executionPlan;

  let bundle;

  try {
    bundle =
      await runCampaign({
        authorised: true,
        environment:
          plan.environment,
        endpoint:
          plan.endpoint,
        authToken,
        authorisationId:
          plan.authorisationId,
        caseIds: [
          plan.caseId
        ],
        trials:
          plan.trials,
        adaptiveRounds:
          plan.adaptiveRounds,
        mutate:
          plan.mutate,
        name:
          'ARL Agent exact remediation retest'
      });
  } catch (error) {
    return blocked(
      `exact_retest_execution_failed:${clean(
        error?.message || 'unknown'
      )}`
    );
  }

  return persistExactRetestRedTeamReservation({
    reservationToken:
      reservation.reservationToken,
    bundle,
    continuationContext:
      reservation.continuationContext
  });
}
