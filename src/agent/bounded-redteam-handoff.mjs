import {
  createRedTeamToken,
  consumeRedTeamUpload,
  listRedTeamAuthorisations
} from '../redteam.js';

import {
  runCampaign
} from '../../redteam/agent-risk-redteam.mjs';

export const BOUNDED_REDTEAM_HANDOFF_SCHEMA =
  'arl.agent.bounded-redteam-handoff.v1';

export const BOUNDED_REDTEAM_EXECUTION_SCHEMA =
  'arl.agent.bounded-redteam-execution.v1';

export const BOUNDED_REDTEAM_RESERVATION_SCHEMA =
  'arl.agent.bounded-redteam-reservation.v1';

function normalise(text) {
  return String(text || '')
    .trim()
    .toLowerCase()
    .replace(/[—–]/g, '-')
    .replace(/\s+/g, ' ');
}

export function detectBoundedTestCommand(userRequest) {
  const text = normalise(userRequest);

  if (!text) {
    return null;
  }

  if (
    /^(?:authorise|authorize)(?: and)? run (?:the )?bounded test[.!?]*$/.test(text) ||
    /^run (?:the )?bounded test[.!?]*$/.test(text) ||
    /^i (?:authorise|authorize) (?:the )?bounded test[.!?]*$/.test(text)
  ) {
    return 'bounded_test_execute';
  }

  return null;
}

function execution({ changed = false, status = 'blocked' } = {}) {
  return {
    type: 'bounded_redteam_execution',
    schema: BOUNDED_REDTEAM_EXECUTION_SCHEMA,
    status,
    executedActionCount: changed ? 1 : 0,
    executedActions:
      changed
        ? [
            {
              action: 'execute_authorised_bounded_redteam',
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

function unavailable(reason) {
  return {
    type: 'bounded_redteam_handoff',
    schema: BOUNDED_REDTEAM_HANDOFF_SCHEMA,
    available: false,
    status: 'blocked',
    reason,
    securityStateChanged: false,
    execution: execution(),
    deploymentDecisionWritten: false,
    humanReviewRequired: true
  };
}

function exactPlanMapping(workflowState) {
  const action = workflowState?.nextAllowedAction || null;
  const mappings =
    workflowState?.authoritativeArtifacts
      ?.evidencePlan?.mappedControls;
  const relevantControls =
    workflowState?.authoritativeArtifacts
      ?.controlIntelligence?.relevantControls;

  if (
    !Array.isArray(mappings) ||
    !Array.isArray(relevantControls)
  ) {
    return null;
  }

  const exactTestControlIds = new Set(
    relevantControls
      .filter(
        (item) =>
          item?.authorityProjection === true &&
          item?.currentStage === 'test' &&
          Boolean(item?.controlId)
      )
      .map((item) => item.controlId)
  );

  if (exactTestControlIds.size === 0) {
    return null;
  }

  const matches = mappings.filter(
    (item) =>
      Boolean(item?.caseId) &&
      exactTestControlIds.has(item?.controlId) &&
      (
        !action?.controlId ||
        item.controlId === action.controlId
      ) &&
      (
        !action?.caseId ||
        item.caseId === action.caseId
      )
  );

  return matches.length === 1
    ? matches[0]
    : null;
}

function activeSafeAuthorisations(authorisations, nowMs) {
  return authorisations.filter((item) => {
    const start = Date.parse(item?.windowStart || '');
    const end = Date.parse(item?.windowEnd || '');

    return (
      item?.status === 'active' &&
      ['local', 'test', 'staging'].includes(item?.environment) &&
      item?.syntheticDataOnly === true &&
      item?.dryRunToolsOnly === true &&
      Number.isFinite(start) &&
      Number.isFinite(end) &&
      start <= nowMs &&
      end > nowMs
    );
  });
}

function adapterEndpoint(origin) {
  try {
    return new URL(
      '/agentrisklayer/evaluate',
      origin
    ).toString();
  } catch {
    return null;
  }
}

export async function prepareBoundedRedTeamReservation({
  workflowState,
  projectId,
  userId,
  assessmentId
} = {}) {
  if (!projectId || !userId || !assessmentId) {
    return unavailable(
      'authoritative_bounded_test_identity_required'
    );
  }

  const action = workflowState?.nextAllowedAction || null;

  if (
    workflowState?.stage !== 'bounded_test_required' ||
    action?.name !== 'authorise_and_run_bounded_test' ||
    action?.actor !== 'user' ||
    action?.requiresUserInput !== true
  ) {
    return unavailable(
      'authoritative_bounded_test_gate_required'
    );
  }

  const mapping = exactPlanMapping(workflowState);

  if (!mapping) {
    return unavailable(
      'bounded_test_evidence_plan_mapping_ambiguous'
    );
  }

  const authorisations =
    await listRedTeamAuthorisations({
      assessmentId,
      userId
    });
  const active =
    activeSafeAuthorisations(
      authorisations,
      Date.now()
    );

  if (active.length === 0) {
    return unavailable(
      'bounded_redteam_authorisation_required'
    );
  }

  if (active.length !== 1) {
    return unavailable(
      'bounded_redteam_authorisation_ambiguous'
    );
  }

  const authorisation = active[0];
  const endpoint =
    adapterEndpoint(authorisation.endpointOrigin);

  if (!endpoint) {
    return unavailable(
      'bounded_redteam_adapter_endpoint_invalid'
    );
  }

  let reservation;

  try {
    reservation = await createRedTeamToken({
      userId,
      assessmentId,
      mode: 'staging',
      authorisationId: authorisation.id
    });
  } catch (error) {
    return unavailable(
      `bounded_redteam_reservation_failed:${String(error?.message || 'unknown')}`
    );
  }

  return {
    type: 'bounded_redteam_reservation',
    schema: BOUNDED_REDTEAM_RESERVATION_SCHEMA,
    available: true,
    status: 'bounded_test_reserved',
    reason: 'authorised_bounded_redteam_reserved',
    reservationToken: reservation.token,
    expiresAt: reservation.expiresAt,
    executionPlan: {
      environment: authorisation.environment,
      endpoint,
      authorisationId: authorisation.id,
      caseId: mapping.caseId,
      trials: 1,
      adaptiveRounds: 1,
      mutate: false
    },
    securityStateChanged: false,
    deploymentDecisionWritten: false,
    humanReviewRequired: true
  };
}

export async function persistBoundedRedTeamReservation({
  reservationToken,
  bundle
} = {}) {
  let persisted;

  try {
    persisted = await consumeRedTeamUpload({
      rawToken: reservationToken,
      bundle
    });
  } catch (error) {
    return unavailable(
      `bounded_redteam_persistence_failed:${String(error?.message || 'unknown')}`
    );
  }

  return {
    type: 'bounded_redteam_handoff',
    schema: BOUNDED_REDTEAM_HANDOFF_SCHEMA,
    available: true,
    status: 'bounded_test_persisted',
    reason: 'authorised_bounded_redteam_persisted',
    persisted: true,
    testOutcomeRecorded: Boolean(persisted?.summary),
    securityStateChanged: true,
    execution: execution({
      changed: true,
      status: 'bounded_test_persisted'
    }),
    deploymentDecisionWritten: false,
    humanReviewRequired: true
  };
}

export async function executeBoundedRedTeamHandoff({
  workflowState,
  projectId,
  userId,
  assessmentId,
  targetToken = process.env.ARL_TARGET_TOKEN || ''
} = {}) {
  const authToken = String(targetToken || '').trim();

  if (!authToken) {
    return unavailable(
      'bounded_redteam_adapter_credential_required'
    );
  }

  const reservation = await prepareBoundedRedTeamReservation({
    workflowState,
    projectId,
    userId,
    assessmentId
  });

  if (reservation.available !== true) {
    return reservation;
  }

  const plan = reservation.executionPlan;
  let bundle;

  try {
    bundle = await runCampaign({
      authorised: true,
      environment: plan.environment,
      endpoint: plan.endpoint,
      authToken,
      authorisationId: plan.authorisationId,
      caseIds: [plan.caseId],
      trials: plan.trials,
      adaptiveRounds: plan.adaptiveRounds,
      mutate: plan.mutate,
      name: 'ARL Agent bounded evidence campaign'
    });
  } catch (error) {
    return unavailable(
      `bounded_redteam_execution_failed:${String(error?.message || 'unknown')}`
    );
  }

  return persistBoundedRedTeamReservation({
    reservationToken: reservation.reservationToken,
    bundle
  });
}