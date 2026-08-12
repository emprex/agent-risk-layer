const STAGES = Object.freeze([
  'applicability',
  'test',
  'evidence',
  'finding',
  'remediation',
  'retest',
  'approval',
  'deployment_decision',
]);

const CLOSED_FINDING_STATES = new Set(['verified_closed', 'accepted_risk']);

const active = (item) => item && item.retentionStatus !== 'deleted_source' && item.retentionStatus !== 'expired';
const verified = (item) => active(item) && item.verificationState === 'verified';
const observedFailureEvidence = (item, failedId) => active(item)
  && ['unverified', 'verified'].includes(item.verificationState)
  && item.testExecutionId === failedId;

function stageStates(currentStage, completed = [], notRequired = []) {
  return Object.fromEntries(STAGES.map((stage) => [
    stage,
    notRequired.includes(stage)
      ? 'not_required'
      : completed.includes(stage)
        ? 'complete'
        : stage === currentStage
          ? 'current'
          : 'blocked',
  ]));
}

function closedFindingIds(data) {
  return new Set((data.findings || [])
    .filter((item) => CLOSED_FINDING_STATES.has(item.status))
    .map((item) => item.id));
}

function initialFailure(data) {
  const closed = closedFindingIds(data);
  const tests = [...(data.testHistory || []), ...(data.tests || [])];
  const seen = new Set();
  return tests.find((item) => {
    if (!item?.id || seen.has(item.id)) return false;
    seen.add(item.id);
    if (item.result !== 'failed' || item.executionKind === 'retest') return false;
    if (item.findingId && closed.has(item.findingId)) return false;
    return true;
  }) || null;
}

function passedExactRetest(data, failed, finding) {
  if (!failed || !finding) return null;
  return (data.testHistory || data.tests || []).find((item) => item.executionKind === 'retest'
    && item.result === 'passed'
    && item.retestOfExecutionId === failed.id
    && item.findingId === finding.id
    && item.systemSnapshotId !== failed.systemSnapshotId) || null;
}

function currentFinding(data) {
  return (data.findings || []).find((item) => !CLOSED_FINDING_STATES.has(item.status)) || null;
}

export function deriveControlJourney(data = {}, remediationRecord = null) {
  const applicability = data.applicability || {};
  const tests = data.tests || [];
  const evidence = data.evidence || [];
  const failed = initialFailure(data);
  const finding = currentFinding(data);
  const approvalRequired = Boolean(data.approvalRequirements?.length);
  const approvalComplete = approvalRequired && (data.approvals || []).some((item) => item.status === 'active');
  const completed = [];
  const notRequired = [];
  let currentStage = 'applicability';
  let nextAction = 'Confirm whether this control applies to this system.';
  let deploymentImpact = 'hold';

  if (applicability.status === 'not_applicable') {
    completed.push('applicability');
    notRequired.push('test', 'evidence', 'finding', 'remediation', 'retest', 'approval');
    currentStage = 'deployment_decision';
    nextAction = 'Review the project deployment decision.';
    deploymentImpact = 'not_applicable';
    return finish();
  }

  if (applicability.status !== 'applicable') {
    notRequired.push('finding', 'remediation', 'retest', 'approval');
    return finish();
  }
  completed.push('applicability');

  // A reproduced unresolved failure is safety-significant and must never be hidden by a later plan.
  if (failed) {
    completed.push('test');
    const hasFailureEvidence = evidence.some((item) => observedFailureEvidence(item, failed.id))
      || (data.evidenceHistory || []).some((item) => observedFailureEvidence(item, failed.id));
    if (!hasFailureEvidence) {
      currentStage = 'evidence';
      nextAction = 'Attach evidence from the reproduced failure.';
      return finish({ failed });
    }
    completed.push('evidence');

    if (!finding) {
      currentStage = 'finding';
      nextAction = 'Create the finding from the reproduced failure.';
      deploymentImpact = 'blocker';
      return finish({ failed });
    }
    completed.push('finding');

    const verification = remediationRecord?.verification || {};
    const planSaved = Boolean(verification.rootCause || verification.correctiveAction || verification.validationPlan);
    const implementationSaved = Boolean(verification.artifactId);
    const remediatedSnapshot = Boolean(failed.systemSnapshotId
      && data.systemSnapshot?.id
      && failed.systemSnapshotId !== data.systemSnapshot.id);

    if (!planSaved || !implementationSaved || !remediatedSnapshot) {
      currentStage = 'remediation';
      nextAction = !planSaved
        ? 'Define the remediation plan.'
        : !implementationSaved
          ? 'Record evidence of the implemented fix.'
          : 'Create the changed system snapshot that contains the fix.';
      deploymentImpact = 'blocker';
      return finish({ failed, finding, remediation: { planSaved, implementationSaved, remediatedSnapshot } });
    }
    completed.push('remediation');

    const retest = passedExactRetest(data, failed, finding);
    if (!retest) {
      currentStage = 'retest';
      nextAction = 'Run the exact original failure against the remediated version.';
      deploymentImpact = 'blocker';
      return finish({ failed, finding });
    }

    // Keep the user at evidence review until the open finding is actually closed.
    currentStage = 'retest';
    nextAction = 'Review the passed retest evidence and close the finding.';
    deploymentImpact = 'blocker';
    return finish({ failed, finding, retest, closureRequired: true });
  }

  const executed = tests.filter((item) => item.result !== 'planned');
  const latest = tests[0] || null;
  if (!executed.length) {
    currentStage = 'test';
    nextAction = latest?.result === 'planned'
      ? 'Run the planned test and record what actually happened.'
      : 'Run or record a bounded test.';
    notRequired.push('finding', 'remediation', 'retest', ...(approvalRequired ? [] : ['approval']));
    return finish();
  }

  if (latest?.result === 'inconclusive') {
    currentStage = 'test';
    nextAction = 'Resolve the inconclusive result with another bounded test or better evidence.';
    notRequired.push('finding', 'remediation', 'retest', ...(approvalRequired ? [] : ['approval']));
    return finish();
  }

  const passed = executed.find((item) => item.result === 'passed');
  if (!passed) {
    currentStage = 'test';
    nextAction = 'Record a completed test result.';
    return finish();
  }
  completed.push('test');

  if (!evidence.some((item) => verified(item) && item.testExecutionId === passed.id)) {
    currentStage = 'evidence';
    nextAction = 'Attach verified evidence for the passed test before treating the control as demonstrated.';
    notRequired.push('finding', 'remediation', 'retest', ...(approvalRequired ? [] : ['approval']));
    return finish();
  }
  completed.push('evidence');
  notRequired.push('finding', 'remediation', 'retest');

  if (approvalRequired && !approvalComplete) {
    currentStage = 'approval';
    nextAction = 'Complete the required exact-action approval.';
    return finish();
  }
  if (approvalComplete) completed.push('approval');
  else notRequired.push('approval');

  currentStage = 'deployment_decision';
  nextAction = 'Review the project deployment decision.';
  deploymentImpact = 'satisfied';
  return finish();

  function finish(extra = {}) {
    return {
      stages: STAGES,
      currentStage,
      nextAction,
      deploymentImpact,
      completedStages: [...new Set(completed)],
      notRequiredStages: [...new Set(notRequired)],
      stageStates: stageStates(currentStage, completed, notRequired),
      failedExecution: extra.failed || failed || null,
      finding: extra.finding || finding || null,
      retest: extra.retest || null,
      closureRequired: Boolean(extra.closureRequired),
      remediation: extra.remediation || null,
    };
  }
}
