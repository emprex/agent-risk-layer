import {
  runArlAgent as runPhase3ArlAgent
} from './arl-conversation-orchestrator.mjs';

import {
  CONVERSATION_RESPONSE_SCHEMA,
  renderConversationAnswer
} from './conversational-workflow.mjs';

import {
  detectBoundedTestCommand,
  executeBoundedRedTeamHandoff
} from './bounded-redteam-handoff.mjs';

import {
  detectExactRetestExecutionCommand,
  executeExactRetestRedTeamHandoff
} from './exact-retest-redteam-handoff.mjs';

import {
  buildCustomerAssessmentReport,
  detectCustomerAssessmentReportCommand,
  renderCustomerAssessmentReport
} from './customer-assessment-report.mjs';

export const OPERATIONAL_ORCHESTRATOR_SCHEMA =
  'arl.agent.operational-orchestrator.v1';

function blockedBoundedTestResponse({
  handoff,
  workflowState
}) {
  const human =
    handoff?.reason ===
      'bounded_redteam_authorisation_ambiguous' ||
    handoff?.reason ===
      'bounded_test_evidence_plan_mapping_ambiguous';

  let message;

  if (
    handoff?.reason ===
      'bounded_redteam_authorisation_required'
  ) {
    message =
      'ARL cannot run this bounded test yet. A current written Rules of Engagement authorisation for this assessment is required before the customer-operated test adapter may be exercised.';
  } else if (
    handoff?.reason ===
      'bounded_redteam_adapter_credential_required'
  ) {
    message =
      'The bounded test is authorised, but the customer-operated adapter credential is not available to the local ARL process. Configure ARL_TARGET_TOKEN outside the conversation and try again.';
  } else if (human) {
    message =
      'ARL found more than one authoritative lineage that could be used for this bounded test. It will not choose a control or Rules of Engagement record automatically.';
  } else if (
    handoff?.reason ===
      'authoritative_bounded_test_gate_required'
  ) {
    message =
      'No bounded test is currently authorised by the authoritative workflow state. ARL will not create or repeat a Red Team run from conversation alone.';
  } else {
    message =
      'ARL could not safely execute and persist the bounded test. No finding, readiness state, or deployment decision was inferred.';
  }

  return {
    type: 'conversation_response',
    schema: CONVERSATION_RESPONSE_SCHEMA,
    command: 'bounded_test_execute',
    stage:
      workflowState?.stage || 'bounded_test_required',
    status:
      human
        ? 'human_action_required'
        : 'user_action_required',
    message,
    nextStep: {
      actor: human ? 'human' : 'user',
      label:
        human
          ? 'review the bounded-test authority lineage'
          : 'satisfy the bounded-test execution requirements',
      requiresUserInput: true
    },
    publicSummary: null,
    needsUserAction: true,
    canAutoAdvance: false,
    acknowledgementOnly: false,
    securityStateChanged: false,
    deploymentDecisionMade: false,
    humanReviewRequired: true
  };
}

function successfulBoundedTestResponse(workflowState) {
  return {
    type: 'conversation_response',
    schema: CONVERSATION_RESPONSE_SCHEMA,
    command: 'bounded_test_execute',
    stage:
      workflowState?.stage || 'evidence_recording_required',
    status: 'arl_ready',
    message:
      'The authorised bounded Red Team test ran through the customer-operated adapter and its signed result is now persisted in ARL. No finding or readiness decision was inferred from the conversation. ARL can now verify and bind the persisted result as authoritative evidence.',
    nextStep: {
      actor: 'arl',
      label:
        'verify the persisted bounded-test result and record authoritative evidence',
      requiresUserInput: false
    },
    publicSummary: null,
    needsUserAction: false,
    canAutoAdvance: true,
    acknowledgementOnly: false,
    securityStateChanged: true,
    deploymentDecisionMade: false,
    humanReviewRequired: true
  };
}

function blockedExactRetestResponse({
  handoff,
  workflowState
}) {
  const persistedUnresolved =
    handoff?.status === 'retest_persisted_unresolved';
  const human =
    persistedUnresolved ||
    handoff?.reason ===
      'exact_retest_evidence_plan_mapping_ambiguous' ||
    handoff?.reason ===
      'exact_retest_failed_baseline_ambiguous' ||
    handoff?.reason ===
      'persisted_exact_retest_ambiguous';

  let message;

  if (persistedUnresolved) {
    message =
      'The authorised retest ran and its signed result was persisted, but ARL could not prove a unique exact baseline-to-retest lineage. The result will not close the finding automatically.';
  } else if (
    handoff?.reason ===
      'exact_retest_rules_of_engagement_not_active' ||
    handoff?.reason ===
      'exact_retest_rules_of_engagement_missing'
  ) {
    message =
      'ARL cannot run the exact retest because the Rules of Engagement used by the failed baseline are no longer available and active. ARL will not silently switch authority.';
  } else if (
    handoff?.reason ===
      'exact_retest_adapter_credential_required'
  ) {
    message =
      'The exact retest is authorised, but the customer-operated adapter credential is not available to the local ARL process. Configure ARL_TARGET_TOKEN outside the conversation and try again.';
  } else if (
    handoff?.reason ===
      'exact_retest_target_or_authorisation_changed'
  ) {
    message =
      'ARL refused the retest because the target or Rules of Engagement no longer match the failed baseline. An exact retest must preserve that authority and target lineage.';
  } else if (
    handoff?.reason ===
      'authoritative_exact_retest_gate_required'
  ) {
    message =
      'No exact retest is currently authorised by the workflow. ARL will not create or repeat a retest from conversation alone.';
  } else if (human) {
    message =
      'ARL cannot prove one unique authoritative lineage for this exact retest. It will not guess which failed baseline or Evidence Plan case should be retested.';
  } else {
    message =
      'ARL could not safely execute and bind the exact retest. The finding remains unresolved and no deployment decision was inferred.';
  }

  return {
    type: 'conversation_response',
    schema: CONVERSATION_RESPONSE_SCHEMA,
    command: 'exact_retest_execute',
    stage:
      workflowState?.stage || 'exact_retest_required',
    status:
      human
        ? 'human_action_required'
        : 'user_action_required',
    message,
    nextStep: {
      actor: human ? 'human' : 'user',
      label:
        human
          ? 'review the exact-retest authority lineage'
          : 'satisfy the exact-retest execution requirements',
      requiresUserInput: true
    },
    publicSummary: null,
    needsUserAction: true,
    canAutoAdvance: false,
    acknowledgementOnly: false,
    securityStateChanged:
      handoff?.securityStateChanged === true,
    deploymentDecisionMade: false,
    humanReviewRequired: true
  };
}

function exactRetestFailedResponse(workflowState) {
  return {
    type: 'conversation_response',
    schema: CONVERSATION_RESPONSE_SCHEMA,
    command: 'exact_retest_execute',
    stage:
      workflowState?.stage || 'exact_retest_required',
    status: 'user_action_required',
    message:
      'The authorised exact retest ran against the same customer-operated target and the control still failed. The signed result is persisted, but the finding remains unresolved and ARL did not infer readiness or deployment approval.',
    nextStep: {
      actor: 'user',
      label:
        'review the failed retest and continue remediation',
      requiresUserInput: true
    },
    publicSummary: null,
    needsUserAction: true,
    canAutoAdvance: false,
    acknowledgementOnly: false,
    securityStateChanged: true,
    deploymentDecisionMade: false,
    humanReviewRequired: true
  };
}

function successfulExactRetestResponse(workflowState) {
  return {
    type: 'conversation_response',
    schema: CONVERSATION_RESPONSE_SCHEMA,
    command: 'exact_retest_execute',
    stage:
      workflowState?.stage ||
      'exact_retest_completion_ready',
    status: 'arl_ready',
    message:
      'The authorised exact retest ran against the same customer-operated target under the same Rules of Engagement and the signed passing result is now persisted in ARL. ARL can now verify the exact lineage before recording retest evidence or closing the finding.',
    nextStep: {
      actor: 'arl',
      label:
        'verify the exact retest lineage and complete the authoritative retest',
      requiresUserInput: false
    },
    publicSummary: null,
    needsUserAction: false,
    canAutoAdvance: true,
    acknowledgementOnly: false,
    securityStateChanged: true,
    deploymentDecisionMade: false,
    humanReviewRequired: true
  };
}

function operationalResult({
  base,
  command,
  handoffKey,
  handoff,
  conversationResponse
}) {
  return {
    ...base,
    intent: {
      type: 'assessment_conversation',
      command
    },
    canonicalData: {
      ...base.canonicalData,
      type: 'conversation_workflow',
      schema: OPERATIONAL_ORCHESTRATOR_SCHEMA,
      [handoffKey]: handoff,
      conversationResponse
    },
    answer:
      renderConversationAnswer(conversationResponse)
  };
}

function customerReportResult({
  base,
  report
}) {
  const workflowState =
    base?.canonicalData?.workflowState || null;
  const priorResponse =
    base?.canonicalData?.conversationResponse || null;
  const available = report?.available === true;
  const conversationResponse = {
    type: 'conversation_response',
    schema: CONVERSATION_RESPONSE_SCHEMA,
    command: 'customer_assessment_report',
    stage: workflowState?.stage || null,
    status:
      available
        ? 'arl_ready'
        : 'user_action_required',
    message:
      available
        ? 'ARL projected the current customer assessment report from authoritative Evidence Plan and Control Intelligence state. The report is read-only and did not create or change security state.'
        : 'ARL cannot project a customer assessment report until the frozen target, Evidence Plan mapping, current snapshot and authoritative readiness are all available and consistent.',
    nextStep:
      priorResponse?.nextStep || {
        actor: 'human',
        label: 'review the authoritative assessment state',
        requiresUserInput: true
      },
    publicSummary: null,
    needsUserAction:
      available
        ? Boolean(priorResponse?.needsUserAction)
        : true,
    canAutoAdvance:
      available
        ? Boolean(priorResponse?.canAutoAdvance)
        : false,
    acknowledgementOnly: false,
    securityStateChanged: false,
    deploymentDecisionMade: false,
    humanReviewRequired: true
  };

  return {
    ...base,
    intent: {
      type: 'assessment_conversation',
      command: 'customer_assessment_report'
    },
    canonicalData: {
      ...base.canonicalData,
      type: 'conversation_workflow',
      schema: OPERATIONAL_ORCHESTRATOR_SCHEMA,
      customerAssessmentReport: report,
      conversationResponse
    },
    answer: renderCustomerAssessmentReport(report)
  };
}

export async function runArlAgent(
  repositoryPath,
  userRequest,
  options = {}
) {
  const customerReportCommand =
    detectCustomerAssessmentReportCommand(userRequest);
  const exactRetestCommand =
    detectExactRetestExecutionCommand(userRequest);
  const boundedTestCommand =
    detectBoundedTestCommand(userRequest);

  if (customerReportCommand) {
    const current =
      await runPhase3ArlAgent(
        repositoryPath,
        'Where are we?',
        options
      );
    const workflowState =
      current?.canonicalData?.workflowState || null;
    const report =
      await buildCustomerAssessmentReport({
        projectId: options.projectId || null,
        userId: options.userId || null,
        workflowState
      });

    return customerReportResult({
      base: current,
      report
    });
  }

  if (!exactRetestCommand && !boundedTestCommand) {
    return runPhase3ArlAgent(
      repositoryPath,
      userRequest,
      options
    );
  }

  const current =
    await runPhase3ArlAgent(
      repositoryPath,
      'Where are we?',
      options
    );
  const workflowState =
    current?.canonicalData?.workflowState || null;

  if (exactRetestCommand) {
    const handoff =
      await executeExactRetestRedTeamHandoff({
        workflowState,
        projectId: options.projectId || null,
        userId: options.userId || null,
        assessmentId: options.assessmentId || null,
        targetToken:
          options.targetToken ||
          process.env.ARL_TARGET_TOKEN || ''
      });

    if (handoff.available !== true) {
      return operationalResult({
        base: current,
        command: exactRetestCommand,
        handoffKey: 'exactRetestRedTeamHandoff',
        handoff,
        conversationResponse:
          blockedExactRetestResponse({
            handoff,
            workflowState
          })
      });
    }

    const reloaded =
      await runPhase3ArlAgent(
        repositoryPath,
        'Where are we?',
        options
      );
    const reloadedState =
      reloaded?.canonicalData?.workflowState || null;
    const response =
      handoff.status === 'exact_retest_failed_persisted'
        ? exactRetestFailedResponse(reloadedState)
        : successfulExactRetestResponse(reloadedState);

    return operationalResult({
      base: reloaded,
      command: exactRetestCommand,
      handoffKey: 'exactRetestRedTeamHandoff',
      handoff,
      conversationResponse: response
    });
  }

  const handoff =
    await executeBoundedRedTeamHandoff({
      workflowState,
      projectId: options.projectId || null,
      userId: options.userId || null,
      assessmentId: options.assessmentId || null,
      targetToken:
        options.targetToken ||
        process.env.ARL_TARGET_TOKEN || ''
    });

  if (handoff.available !== true) {
    return operationalResult({
      base: current,
      command: boundedTestCommand,
      handoffKey: 'boundedRedTeamHandoff',
      handoff,
      conversationResponse:
        blockedBoundedTestResponse({
          handoff,
          workflowState
        })
    });
  }

  const reloaded =
    await runPhase3ArlAgent(
      repositoryPath,
      'Where are we?',
      options
    );
  const reloadedState =
    reloaded?.canonicalData?.workflowState || null;

  return operationalResult({
    base: reloaded,
    command: boundedTestCommand,
    handoffKey: 'boundedRedTeamHandoff',
    handoff,
    conversationResponse:
      successfulBoundedTestResponse(reloadedState)
  });
}
