import {
  getControlIntelligenceControl,
  getControlIntelligenceReportSummary
} from '../control-intelligence.js';

import {
  getDeploymentReadiness
} from './tools/get-deployment-readiness.mjs';

export const CUSTOMER_ASSESSMENT_REPORT_SCHEMA =
  'arl.customer-assessment-report.v1';

const CLOSED_FINDING_STATES =
  new Set(['verified_closed', 'accepted_risk']);

function normalise(text) {
  return String(text || '')
    .trim()
    .toLowerCase()
    .replace(/[—–]/g, '-')
    .replace(/\s+/g, ' ');
}

export function detectCustomerAssessmentReportCommand(userRequest) {
  const text = normalise(userRequest);
  if (!text) return null;

  if (
    /^(?:show|generate|create|open)(?: the| my)? (?:customer )?assessment report[.!?]*$/.test(text) ||
    /^(?:show|generate|create|open)(?: the| my)? customer report[.!?]*$/.test(text) ||
    /^(?:customer )?assessment report[.!?]*$/.test(text) ||
    /^customer report[.!?]*$/.test(text)
  ) {
    return 'customer_assessment_report';
  }

  return null;
}

function unavailable(reason) {
  return {
    schema: CUSTOMER_ASSESSMENT_REPORT_SCHEMA,
    available: false,
    projection: 'read_only',
    reason,
    securityStateChanged: false,
    deploymentDecisionWritten: false,
    humanReviewRequired: true
  };
}

function mappedControlIds(workflowState) {
  const mappings =
    workflowState?.authoritativeArtifacts
      ?.evidencePlan?.mappedControls;

  if (!Array.isArray(mappings)) return [];

  return [...new Set(
    mappings
      .map((item) => item?.controlId)
      .filter(Boolean)
  )].sort();
}

function readinessLabel(decision) {
  if (decision === 'proceed') return 'PROCEED';
  if (decision === 'do_not_deploy') return 'DO NOT DEPLOY';
  if (decision === 'hold') return 'HOLD';
  return null;
}

function projectTest(item) {
  return {
    executionKind: item?.executionKind || null,
    result: item?.result || null,
    executionMethod: item?.executionMethod || null,
    expectedResult: item?.expectedResult || null,
    observedResult: item?.observedResult || null,
    failureReason: item?.failureReason || null,
    limitations: item?.limitations || null,
    startedAt: item?.startedAt || null,
    completedAt: item?.completedAt || null
  };
}

function projectFinding(item) {
  return {
    title: item?.title || null,
    contextualSeverity: item?.contextualSeverity || null,
    severityStatus: item?.severityStatus || null,
    status: item?.status || null,
    createdAt: item?.createdAt || null,
    updatedAt: item?.updatedAt || null
  };
}

function projectRecordedDecision(item) {
  if (!item) return null;
  return {
    decision: item.decision || null,
    status: item.status || null,
    rationale: item.rationale || null,
    decisionMethod: item.decisionMethod || null,
    decidedAt: item.decidedAt || null,
    expiresAt: item.expiresAt || null,
    reassessmentTrigger: item.reassessmentTrigger || null
  };
}

function uniqueTests(items = []) {
  const seen = new Set();
  const projected = [];

  for (const item of items) {
    const key = item?.id || [
      item?.executionKind,
      item?.result,
      item?.startedAt,
      item?.completedAt
    ].join('|');
    if (seen.has(key)) continue;
    seen.add(key);
    projected.push(projectTest(item));
  }

  return projected;
}

function projectControl(detail) {
  const history = uniqueTests([
    ...(Array.isArray(detail?.testHistory)
      ? detail.testHistory
      : []),
    ...(Array.isArray(detail?.tests)
      ? detail.tests
      : [])
  ]);
  const findings =
    (Array.isArray(detail?.findings)
      ? detail.findings
      : [])
      .map(projectFinding);
  const remediation =
    (Array.isArray(detail?.remediation)
      ? detail.remediation
      : [])
      .map(projectFinding);
  const evidence =
    Array.isArray(detail?.evidence)
      ? detail.evidence
      : [];

  return {
    controlId: detail?.control?.id || null,
    title: detail?.control?.title || null,
    category: detail?.control?.category || null,
    applicability: {
      status: detail?.applicability?.status || null,
      reason: detail?.applicability?.reason || null,
      evaluatedAt: detail?.applicability?.evaluatedAt || null
    },
    authorityState: {
      currentStage: detail?.chain?.currentStage || null,
      chainStatus: detail?.chain?.chainStatus || null,
      deploymentImpact: detail?.chain?.deploymentImpact || null,
      nextAction: detail?.chain?.nextAction || null
    },
    tests: history.filter(
      (item) => item.executionKind !== 'retest'
    ),
    retests: history.filter(
      (item) => item.executionKind === 'retest'
    ),
    evidence: {
      currentItems: evidence.length,
      verifiedActiveItems: evidence.filter(
        (item) =>
          item?.verificationState === 'verified' &&
          item?.retentionStatus === 'active'
      ).length
    },
    findings,
    remediation,
    verifiedClosed:
      findings.some(
        (item) => item.status === 'verified_closed'
      ),
    unresolvedFindingCount:
      findings.filter(
        (item) =>
          !CLOSED_FINDING_STATES.has(item.status)
      ).length
  };
}

export function projectCustomerAssessmentReport({
  workflowState,
  reportSummary,
  readiness,
  controlDetails
}) {
  const frozenTarget =
    workflowState?.authoritativeArtifacts
      ?.frozenTarget || {};
  const evidencePlan =
    workflowState?.authoritativeArtifacts
      ?.evidencePlan || {};
  const controls =
    (Array.isArray(controlDetails)
      ? controlDetails
      : [])
      .map(projectControl)
      .sort((left, right) =>
        String(left.controlId)
          .localeCompare(String(right.controlId))
      );
  const recordedDecision =
    projectRecordedDecision(
      reportSummary?.deploymentDecision || null
    );

  return {
    schema: CUSTOMER_ASSESSMENT_REPORT_SCHEMA,
    available: true,
    projection: 'read_only',
    assessment: {
      workflowStage: workflowState?.stage || null,
      projectName: reportSummary?.project?.name || null,
      targetRevision: frozenTarget.revision || null,
      systemSnapshotVersion:
        reportSummary?.systemSnapshot?.version || null,
      controlProfileVersion:
        reportSummary?.controlProfileVersion || null,
      scopeStatement:
        reportSummary?.scope?.included || null,
      scopeExclusions:
        reportSummary?.scope?.exclusions || null,
      evidencePlanState: evidencePlan.state || null,
      boundedChecks:
        Number(evidencePlan.boundedChecks || 0),
      manualItems:
        Number(evidencePlan.manualItems || 0),
      mappedControlCount: controls.length
    },
    controls,
    summary: {
      controlsReviewed:
        Number(reportSummary?.controlsReviewed || 0),
      applicableControls:
        Number(reportSummary?.applicableControls || 0),
      observedControls:
        Number(reportSummary?.observedControls || 0),
      missingEvidence:
        Array.isArray(reportSummary?.missingEvidence)
          ? [...reportSummary.missingEvidence]
          : [],
      openFindings:
        Array.isArray(reportSummary?.openFindings)
          ? reportSummary.openFindings.map((item) => ({
              controlId: item?.controlId || null,
              status: item?.status || null,
              severity: item?.severity || null
            }))
          : [],
      historicalRiskPending:
        reportSummary?.historicalRiskPending === true
    },
    readiness: {
      available: readiness?.available === true,
      status: readinessLabel(readiness?.decision),
      decision: readiness?.decision || null,
      rationale: readiness?.rationale || null,
      reasons:
        Array.isArray(readiness?.reasons)
          ? [...readiness.reasons]
          : [],
      summary: readiness?.summary || null,
      humanReviewRequired: true,
      finalDecisionAuthority: 'human',
      finalDecisionRecorded: Boolean(recordedDecision),
      recordedDecision,
      conversationLayerDecisionWritten: false
    },
    statement:
      reportSummary?.statement || null,
    disclaimer:
      reportSummary?.disclaimer || null,
    limitations:
      Array.isArray(reportSummary?.limitations)
        ? [...reportSummary.limitations]
        : [],
    securityStateChanged: false,
    deploymentDecisionWritten: false,
    humanReviewRequired: true
  };
}

export async function buildCustomerAssessmentReport({
  projectId,
  userId,
  workflowState
} = {}) {
  if (!projectId || !userId) {
    return unavailable(
      'authoritative_report_identity_required'
    );
  }

  const frozenTarget =
    workflowState?.authoritativeArtifacts
      ?.frozenTarget;
  const evidencePlan =
    workflowState?.authoritativeArtifacts
      ?.evidencePlan;
  const expectedSnapshotId =
    workflowState?.authoritativeArtifacts
      ?.controlIntelligence?.systemSnapshotId ||
    workflowState?.authoritativeArtifacts
      ?.assessmentContext?.systemSnapshotId ||
    null;
  const controlIds = mappedControlIds(workflowState);

  if (
    frozenTarget?.available !== true ||
    !frozenTarget?.revision ||
    evidencePlan?.available !== true ||
    controlIds.length === 0 ||
    !expectedSnapshotId
  ) {
    return unavailable(
      'authoritative_report_scope_required'
    );
  }

  const readiness = await getDeploymentReadiness({
    projectId,
    userId
  });

  if (readiness?.available !== true) {
    return unavailable(
      readiness?.reason ||
        'authoritative_readiness_unavailable'
    );
  }

  const [reportSummary, ...controlDetails] =
    await Promise.all([
      getControlIntelligenceReportSummary({ projectId }),
      ...controlIds.map((controlId) =>
        getControlIntelligenceControl({
          projectId,
          controlId,
          userId,
          historyLimit: 50
        })
      )
    ]);

  if (!reportSummary?.systemSnapshot?.id) {
    return unavailable(
      'authoritative_report_summary_unavailable'
    );
  }

  const snapshotIds = new Set([
    expectedSnapshotId,
    readiness.systemSnapshotId,
    reportSummary.systemSnapshot.id,
    ...controlDetails.map(
      (detail) => detail?.systemSnapshot?.id
    )
  ].filter(Boolean));

  if (snapshotIds.size !== 1) {
    return unavailable(
      'authoritative_report_snapshot_mismatch'
    );
  }

  const returnedControlIds = new Set(
    controlDetails
      .map((detail) => detail?.control?.id)
      .filter(Boolean)
  );

  if (
    returnedControlIds.size !== controlIds.length ||
    controlIds.some(
      (controlId) => !returnedControlIds.has(controlId)
    )
  ) {
    return unavailable(
      'authoritative_report_control_scope_mismatch'
    );
  }

  return projectCustomerAssessmentReport({
    workflowState,
    reportSummary,
    readiness,
    controlDetails
  });
}

export function renderCustomerAssessmentReport(report) {
  if (report?.available !== true) {
    return [
      'CUSTOMER ASSESSMENT REPORT',
      '',
      'Report unavailable.',
      `Reason: ${report?.reason || 'authoritative_report_unavailable'}`,
      '',
      'No security state or deployment decision was changed.'
    ].join('\n');
  }

  const lines = [
    'CUSTOMER ASSESSMENT REPORT',
    '',
    'Scope',
    `Project: ${report.assessment.projectName || 'Unknown'}`,
    `Target revision: ${report.assessment.targetRevision || 'Unknown'}`,
    `System snapshot: ${report.assessment.systemSnapshotVersion || 'Unknown'}`,
    `Control profile: ${report.assessment.controlProfileVersion || 'Unknown'}`,
    `Mapped controls: ${report.assessment.mappedControlCount}`,
    ''
  ];

  for (const control of report.controls) {
    lines.push(
      `${control.controlId} — ${control.title || 'Control'}`,
      `Applicability: ${control.applicability.status || 'unknown'}`,
      `Authority stage: ${control.authorityState.currentStage || 'unknown'}`,
      `Tests: ${control.tests.map((item) => item.result || 'unknown').join(', ') || 'none'}`,
      `Retests: ${control.retests.map((item) => item.result || 'unknown').join(', ') || 'none'}`,
      `Findings: ${control.findings.map((item) => item.status || 'unknown').join(', ') || 'none'}`,
      `Verified closed: ${control.verifiedClosed ? 'YES' : 'NO'}`,
      ''
    );
  }

  lines.push(
    'Readiness',
    `Status: ${report.readiness.status || 'UNAVAILABLE'}`,
    `Rationale: ${report.readiness.rationale || 'No authoritative rationale available.'}`,
    `Human review required: ${report.readiness.humanReviewRequired ? 'YES' : 'NO'}`,
    `Final deployment decision recorded: ${report.readiness.finalDecisionRecorded ? 'YES' : 'NO'}`,
    'The report is read-only. It does not create evidence, findings, closure, readiness, or a deployment decision.'
  );

  if (report.disclaimer) {
    lines.push('', report.disclaimer);
  }

  return lines.join('\n');
}
