import * as core from './control-intelligence-core.js';
import { db } from './db.js';

export * from './control-intelligence-core.js';

const CLOSED_FINDING_STATES = new Set(['verified_closed', 'accepted_risk']);
const STAGES = ['applicability', 'test', 'evidence', 'finding', 'remediation', 'retest', 'approval', 'deployment_decision'];
const IMPLEMENTATION_TRUST_LIMIT = 'A remediation implementation artifact proves that a change artifact exists; it does not verify the observed test or retest outcome.';
const APPROVAL_TRUST_LIMIT = 'An approval record verifies the approval event; by itself it does not verify the observed test or retest outcome.';
const TEMPORAL_TRUST_LIMIT = 'Evidence cannot verify a test outcome when its observed timestamp predates completion of the linked test.';

function semanticError(message, statusCode = 409) {
  return Object.assign(new Error(message), { statusCode });
}

function parseTime(value) {
  if (!value) return null;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function appendLimitation(existing, addition) {
  const current = String(existing || '').trim();
  if (!current) return addition;
  if (current.includes(addition)) return current;
  return `${current} ${addition}`;
}

function effectiveEvidenceTrust(row) {
  const storedState = row?.verification_state || row?.verificationState || 'unverified';
  if (storedState !== 'verified') return { state: storedState, reason: null };

  const observedAt = parseTime(row.observed_at || row.observedAt);
  const completedAt = parseTime(row.completed_at || row.completedAt);
  if (row.test_execution_id || row.testExecutionId) {
    if (completedAt != null && (observedAt == null || observedAt < completedAt)) {
      return { state: 'unverified', reason: TEMPORAL_TRUST_LIMIT };
    }
    const runtimeId = row.runtime_event_id || row.runtimeEventId;
    const approvalId = row.approval_id || row.approvalId;
    const artifactId = row.remediation_artifact_id || row.remediationArtifactId;
    if (artifactId && !runtimeId) return { state: 'unverified', reason: IMPLEMENTATION_TRUST_LIMIT };
    if (approvalId && !runtimeId) return { state: 'unverified', reason: APPROVAL_TRUST_LIMIT };
  }

  const artifactId = row.remediation_artifact_id || row.remediationArtifactId;
  const runtimeId = row.runtime_event_id || row.runtimeEventId;
  const approvalId = row.approval_id || row.approvalId;
  if (artifactId && !runtimeId && !approvalId) {
    return { state: 'unverified', reason: IMPLEMENTATION_TRUST_LIMIT };
  }
  return { state: 'verified', reason: null };
}

async function evidenceTrustRows(projectId, snapshotId, controlId = null) {
  if (!projectId || !snapshotId) return [];
  const controlFilter = controlId ? ' AND e.entry_id=?' : '';
  const params = controlId ? [projectId, snapshotId, controlId] : [projectId, snapshotId];
  return db.prepare(`SELECT e.id,e.entry_id,e.verification_state,e.retention_status,e.remediation_artifact_id,e.runtime_event_id,e.approval_id,e.observed_at,e.test_execution_id,t.completed_at
    FROM control_evidence_items e
    LEFT JOIN control_test_executions t ON t.id=e.test_execution_id AND t.project_id=e.project_id
    WHERE e.project_id=? AND e.system_snapshot_id=?${controlFilter}`)
    .all(...params);
}

function effectiveEvidenceMap(rows) {
  return new Map(rows.map((row) => [row.id, effectiveEvidenceTrust(row)]));
}

function applyEffectiveEvidenceTrust(detail, rows) {
  const trust = effectiveEvidenceMap(rows);
  const evidence = (detail.evidence || []).map((item) => {
    const effective = trust.get(item.id);
    if (!effective || effective.state === item.verificationState) return item;
    return {
      ...item,
      storedVerificationState: item.verificationState,
      verificationState: effective.state,
      trustReason: effective.reason,
    };
  });
  return { ...detail, evidence };
}

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

function hasVerifiedRetestEvidence(detail, retest) {
  if (!retest) return false;
  return (detail.evidence || []).some((item) => item.testExecutionId === retest.id
    && item.retentionStatus === 'active'
    && item.verificationState === 'verified');
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
  else notRequired.add('approval');

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
          nextAction = hasVerifiedRetestEvidence(detail, retest)
            ? 'Review the verified passed exact retest evidence and close the finding.'
            : 'Verify evidence for the passed exact retest before closing the finding.';
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
  const raw = await core.getControlIntelligenceControl(args);
  const rows = await evidenceTrustRows(args.projectId, raw.systemSnapshot?.id, args.controlId);
  return repairFailureJourney(applyEffectiveEvidenceTrust(raw, rows));
}

export async function getControlIntelligence(args) {
  const result = await core.getControlIntelligence(args);
  if (!result?.items?.length) return result;

  let testsToRunDelta = 0;
  let blockersDelta = 0;
  const repairedItems = [];
  for (const item of result.items) {
    if (['finding_open', 'remediation_in_progress'].includes(item.chainStatus)) {
      try {
        const detail = await getControlIntelligenceControl({
          projectId: args.projectId,
          controlId: item.controlId,
          userId: args.userId,
        });
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

  const rows = await evidenceTrustRows(args.projectId, result.systemSnapshot?.id);
  const invalidStoredVerified = rows.filter((row) => row.verification_state === 'verified' && effectiveEvidenceTrust(row).state !== 'verified');
  const validVerifiedControls = new Set(rows.filter((row) => row.retention_status === 'active' && effectiveEvidenceTrust(row).state === 'verified').map((row) => row.entry_id));
  const summary = result.summary ? {
    ...result.summary,
    testsToRun: Math.max(0, Number(result.summary.testsToRun || 0) + testsToRunDelta),
    deploymentBlockers: Math.max(0, Number(result.summary.deploymentBlockers || 0) + blockersDelta),
    controlsWithObservedEvidence: Math.min(Number(result.summary.controlsWithObservedEvidence || 0), validVerifiedControls.size),
    evidenceTrustExceptions: invalidStoredVerified.length,
  } : result.summary;
  return { ...result, items: repairedItems, summary };
}

export async function getControlIntelligenceReportSummary(args) {
  const report = await core.getControlIntelligenceReportSummary(args);
  if (!report?.systemSnapshot?.id) return report;
  const rows = await evidenceTrustRows(args.projectId, report.systemSnapshot.id);
  const validVerifiedControls = new Set(rows.filter((row) => row.retention_status === 'active' && effectiveEvidenceTrust(row).state === 'verified').map((row) => row.entry_id));
  const invalidStoredVerified = rows.filter((row) => row.verification_state === 'verified' && effectiveEvidenceTrust(row).state !== 'verified');
  const applicableIds = (report.applicabilityDecisions || []).filter((item) => item.decision === 'applicable').map((item) => item.controlId);
  return {
    ...report,
    observedControls: validVerifiedControls.size,
    missingEvidence: applicableIds.filter((controlId) => !validVerifiedControls.has(controlId)),
    stale: Boolean(report.stale || invalidStoredVerified.length),
    limitations: invalidStoredVerified.length
      ? [...(report.limitations || []), 'Legacy evidence whose stored verification depended only on remediation implementation artifacts or impossible test timing is treated as unverified by the current evidence policy.']
      : report.limitations,
  };
}

export async function recordControlEvidence(args) {
  const input = { ...(args?.input || {}) };
  if (input.testExecutionId) {
    const detail = await core.getControlIntelligenceControl({
      projectId: args.projectId,
      controlId: args.controlId,
      userId: args.userId,
    });
    const candidates = [...(detail.tests || []), ...(detail.testHistory || [])];
    const execution = candidates.find((item) => item.id === input.testExecutionId);
    if (execution?.completedAt) {
      const completedAt = parseTime(execution.completedAt);
      if (input.observedAt) {
        const observedAt = parseTime(input.observedAt);
        if (observedAt == null) throw semanticError('Evidence observedAt must be a valid timestamp.', 400);
        if (completedAt != null && observedAt < completedAt) {
          throw semanticError('Evidence observedAt cannot precede completion of the linked test.');
        }
      } else {
        input.observedAt = execution.completedAt;
      }
    }
  }

  if (input.remediationArtifactId && !input.runtimeEventId && !input.approvalId) {
    delete input.remediationArtifactId;
    input.limitations = appendLimitation(input.limitations, IMPLEMENTATION_TRUST_LIMIT);
  }
  if (input.testExecutionId && input.approvalId && !input.runtimeEventId) {
    input.limitations = appendLimitation(input.limitations, APPROVAL_TRUST_LIMIT);
  }
  return core.recordControlEvidence({ ...args, input });
}

export async function closeControlFinding(args) {
  const detail = await getControlIntelligenceControl({
    projectId: args.projectId,
    controlId: args.controlId,
    userId: args.userId,
  });
  const finding = (detail.findings || []).find((item) => item.id === args.findingId);
  if (!finding) return core.closeControlFinding(args);
  const { failed } = unresolvedFailure(detail);
  const retest = passedExactRetest(detail, failed, finding);
  if (!retest) return core.closeControlFinding(args);

  const evidenceRows = await db.prepare(`SELECT e.*,t.completed_at FROM control_evidence_items e
    LEFT JOIN control_test_executions t ON t.id=e.test_execution_id AND t.project_id=e.project_id
    WHERE e.project_id=? AND e.system_snapshot_id=? AND e.entry_id=? AND e.test_execution_id=? AND e.finding_id=? AND e.remediation_id=? AND e.retention_status='active'
    ORDER BY e.observed_at DESC`)
    .all(args.projectId, detail.systemSnapshot.id, args.controlId, retest.id, finding.id, finding.id);
  const trusted = evidenceRows.find((row) => effectiveEvidenceTrust(row).state === 'verified' && row.runtime_event_id);
  if (!trusted) {
    throw semanticError('Finding closure requires verified evidence from a source that actually proves the exact retest outcome. Owner-entered results, approval records, and remediation implementation artifacts do not independently verify a retest.');
  }
  return core.closeControlFinding(args);
}

export async function recordDeploymentDecision(args) {
  const overview = await core.getControlIntelligence({ projectId: args.projectId, userId: args.userId, limit: 1 });
  const rows = await evidenceTrustRows(args.projectId, overview.systemSnapshot?.id);
  const invalidStoredVerified = rows.filter((row) => row.verification_state === 'verified' && effectiveEvidenceTrust(row).state !== 'verified');
  if (invalidStoredVerified.length) {
    throw semanticError('Deployment decision blocked: current snapshot contains legacy evidence whose stored verification is not valid under the current evidence policy. Reassess with trustworthy evidence before recording a deployment decision.');
  }
  return core.recordDeploymentDecision(args);
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
      throw semanticError('A reproduced failure is already recorded for this control. Attach evidence, create the finding, and remediate it before planning another initial test.');
    }
    const existingPlan = (detail.tests || []).find((item) => item.result === 'planned' && item.executionKind !== 'retest');
    if (existingPlan) {
      throw semanticError('A planned test already exists for this control. Record the observed result instead of creating another plan.');
    }
  }
  return core.recordControlTestExecution(args);
}
