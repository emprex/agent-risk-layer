import * as core from './control-intelligence-core.js';

export * from './control-intelligence-core.js';

const CLOSED_FINDING_STATES = new Set(['verified_closed', 'accepted_risk']);
const STAGES = ['applicability', 'test', 'evidence', 'finding', 'remediation', 'retest', 'approval', 'deployment_decision'];

function unresolvedFailure(detail) {
  const findings = detail.findings || [];
  const closedIds = new Set(findings.filter((item) => CLOSED_FINDING_STATES.has(item.status)).map((item) => item.id));
  const open = findings.find((item) => !CLOSED_FINDING_STATES.has(item.status));
  const tests = [...(detail.testHistory || []), ...(detail.tests || [])];
  const seen = new Set();
  const failed = tests.find((item) => {
    if (!item?.id || seen.has(item.id)) return false;
    seen.add(item.id);
    if (item.result !== 'failed' || item.executionKind === 'retest') return false;
    if (item.findingId && closedIds.has(item.findingId)) return false;
    if (open?.id && item.findingId && item.findingId !== open.id) return false;
    return true;
  }) || null;
  return { failed, open };
}

function passedExactRetest(detail, failed, finding) {
  if (!failed || !finding) return null;
  return (detail.testHistory || detail.tests || []).find((item) => item.executionKind === 'retest'
    && item.result === 'passed'
    && item.retestOfExecutionId === failed.id
    && item.findingId === finding.id
    && item.systemSnapshotId !== failed.systemSnapshotId) || null;
}

function repairedStageStates(currentStage, completedStages, notRequiredStages) {
  const completed = new Set(completedStages);
  const notRequired = new Set(notRequiredStages);
  return Object.fromEntries(STAGES.map((stage) => [
    stage,
    notRequired.has(stage) ? 'not_required' : completed.has(stage) ? 'complete' : stage === currentStage ? 'current' : 'blocked',
  ]));
}

function repairFailureJourney(detail) {
  if (!detail?.chain) return detail;
  const { failed, open } = unresolvedFailure(detail);
  if (!failed && !open) return detail;

  const chain = { ...detail.chain };
  const approvalRequired = Boolean(detail.approvalRequirements?.length);
  const completed = new Set(chain.completedStages || []);
  const notRequired = new Set((chain.notRequiredStages || []).filter((stage) => !['finding', 'remediation', 'retest'].includes(stage)));
  completed.add('applicability');
  completed.add('test');
  notRequired.delete('finding');
  notRequired.delete('remediation');
  notRequired.delete('retest');
  if (approvalRequired) notRequired.delete('approval');

  const failureEvidence = open ? true : (detail.evidence || []).some((item) => item.testExecutionId === failed?.id
    && item.retentionStatus === 'active'
    && ['unverified', 'verified'].includes(item.verificationState));

  let currentStage = 'evidence';
  let nextAction = 'Attach observed evidence to the failed test.';
  let deploymentImpact = 'hold';

  if (failureEvidence) {
    completed.add('evidence');
    if (!open && !(detail.findings || []).length) {
      currentStage = 'finding';
      nextAction = 'Create or link a finding for the failed test.';
      deploymentImpact = 'blocker';
    } else {
      const finding = open || (detail.findings || [])[0];
      completed.add('finding');
      deploymentImpact = 'blocker';
      const implementationRecorded = finding && finding.status !== 'open';
      const remediatedSnapshotReady = Boolean(failed?.systemSnapshotId
        && detail.systemSnapshot?.id
        && failed.systemSnapshotId !== detail.systemSnapshot.id);
      if (!implementationRecorded || !remediatedSnapshotReady) {
        currentStage = 'remediation';
        nextAction = implementationRecorded && !remediatedSnapshotReady
          ? 'Create a remediated system snapshot before retesting.'
          : 'Record and implement remediation.';
      } else {
        completed.add('remediation');
        const retest = passedExactRetest(detail, failed, finding);
        currentStage = 'retest';
        if (retest && open) {
          nextAction = 'Review the passed exact retest evidence and close the finding.';
        } else if (!retest) {
          nextAction = 'Retest the exact original failure against the remediated snapshot.';
        } else {
          completed.add('retest');
          currentStage = approvalRequired ? 'approval' : 'deployment_decision';
          nextAction = approvalRequired ? 'Complete the required exact-action approval.' : 'Review the project deployment decision.';
        }
      }
    }
  }

  chain.currentStage = currentStage;
  chain.nextAction = nextAction;
  chain.deploymentImpact = deploymentImpact;
  chain.chainStatus = open ? (open.status === 'open' ? 'finding_open' : 'remediation_in_progress') : 'test_failed';
  chain.completedStages = [...completed];
  chain.notRequiredStages = [...notRequired];
  chain.stageStates = repairedStageStates(currentStage, chain.completedStages, chain.notRequiredStages);
  chain.blockedStages = STAGES.filter((stage) => chain.stageStates[stage] === 'blocked');
  chain.missingStages = STAGES.filter((stage) => chain.stageStates[stage] === 'current');
  chain.missingRequirements = [nextAction];
  chain.availableActions = currentStage === 'evidence'
    ? ['record_evidence']
    : currentStage === 'finding'
      ? ['create_finding']
      : currentStage === 'remediation'
        ? ['record_remediation']
        : currentStage === 'retest'
          ? ['record_retest']
          : currentStage === 'approval'
            ? ['record_approval']
            : [];
  return { ...detail, chain };
}

export async function getControlIntelligenceControl(args) {
  const detail = await core.getControlIntelligenceControl(args);
  return repairFailureJourney(detail);
}

export async function getControlIntelligence(args) {
  const result = await core.getControlIntelligence(args);
  if (!result?.items?.length) return result;

  let testsToRunDelta = 0;
  let blockersDelta = 0;
  const repairedItems = [];
  for (const item of result.items) {
    if (item.chainStatus === 'finding_open' && item.currentStage === 'test') {
      try {
        const detail = repairFailureJourney(await core.getControlIntelligenceControl({
          projectId: args.projectId,
          controlId: item.controlId,
          userId: args.userId,
        }));
        const repaired = { ...item, ...detail.chain };
        if (item.currentStage === 'test' && repaired.currentStage !== 'test') testsToRunDelta -= 1;
        if (item.deploymentImpact !== 'blocker' && repaired.deploymentImpact === 'blocker') blockersDelta += 1;
        repairedItems.push(repaired);
        continue;
      } catch {
        // Preserve the core result if the focused repair cannot be loaded.
      }
    }
    repairedItems.push(item);
  }

  const summary = result.summary ? {
    ...result.summary,
    testsToRun: Math.max(0, Number(result.summary.testsToRun || 0) + testsToRunDelta),
    deploymentBlockers: Math.max(0, Number(result.summary.deploymentBlockers || 0) + blockersDelta),
  } : result.summary;
  return { ...result, items: repairedItems, summary };
}

export async function recordControlTestExecution(args) {
  const result = String(args?.input?.result || '').trim().toLowerCase();
  if (result === 'planned') {
    const detail = await core.getControlIntelligenceControl({
      projectId: args.projectId,
      controlId: args.controlId,
      userId: args.userId,
    });
    const { failed, open } = unresolvedFailure(detail);
    if (failed || open) {
      throw Object.assign(new Error('A reproduced failure is already recorded for this control. Attach evidence, create the finding, and remediate it before planning another initial test.'), { statusCode: 409 });
    }
    const existingPlan = (detail.tests || []).find((item) => item.result === 'planned' && item.executionKind !== 'retest');
    if (existingPlan) {
      throw Object.assign(new Error('A planned test already exists for this control. Record the observed result instead of creating another plan.'), { statusCode: 409 });
    }
  }
  return core.recordControlTestExecution(args);
}
