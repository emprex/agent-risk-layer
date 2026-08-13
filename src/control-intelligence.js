import { db, id, nowIso } from './db.js';
import { intelligenceDigest } from './control-intelligence-core.js';
import {
  createControlFinding as createServiceControlFinding,
  getControlIntelligence as getServiceControlIntelligence,
  getControlIntelligenceControl as getServiceControlIntelligenceControl,
  getControlIntelligenceReportSummary as getServiceControlIntelligenceReportSummary,
  recordControlEvidence as recordServiceControlEvidence,
  recordDeploymentDecision as recordServiceDeploymentDecision,
} from './control-intelligence-service.js';

export * from './control-intelligence-service.js';

const CLOSED_FINDING_STATES = new Set(['verified_closed', 'accepted_risk']);
const STAGES = ['applicability', 'test', 'evidence', 'finding', 'remediation', 'retest', 'approval', 'deployment_decision'];

function parseJson(value, fallback = null) {
  try { return JSON.parse(value); } catch { return fallback; }
}

function unresolvedHistoricalFailure(detail) {
  const open = (detail.findings || []).find((item) => !CLOSED_FINDING_STATES.has(item.status)) || null;
  const closedIds = new Set((detail.findings || [])
    .filter((item) => CLOSED_FINDING_STATES.has(item.status))
    .map((item) => item.id));
  const currentSnapshotId = detail.systemSnapshot?.id;
  const tests = [...(detail.testHistory || []), ...(detail.tests || [])];
  const seen = new Set();
  return tests.find((item) => {
    if (!item?.id || seen.has(item.id)) return false;
    seen.add(item.id);
    if (item.result !== 'failed' || item.executionKind === 'retest') return false;
    if (!item.systemSnapshotId || item.systemSnapshotId === currentSnapshotId) return false;
    if (item.findingId && closedIds.has(item.findingId)) return false;
    if (open?.id && item.findingId !== open.id) return false;
    return true;
  }) || null;
}

function verifyAndSerializeHistoricalEvidence(row) {
  const descriptor = parseJson(row?.descriptor_json, null);
  if (!descriptor || intelligenceDigest(descriptor) !== row.integrity_digest) {
    throw Object.assign(new Error('Historical failure evidence integrity verification failed.'), {
      statusCode: 503,
      code: 'CONTROL_INTELLIGENCE_INTEGRITY_FAILURE',
    });
  }
  if (descriptor.projectId !== row.project_id
    || descriptor.systemSnapshotId !== row.system_snapshot_id
    || descriptor.controlId !== row.entry_id
    || (descriptor.testExecutionId || null) !== (row.test_execution_id || null)
    || descriptor.evidenceClass !== row.evidence_class
    || descriptor.sourceType !== row.source_type
    || descriptor.sourceReference !== row.source_reference
    || descriptor.retentionStatus !== row.retention_status
    || descriptor.verificationState !== row.verification_state) {
    throw Object.assign(new Error('Historical failure evidence provenance does not match its stored descriptor.'), {
      statusCode: 503,
      code: 'CONTROL_INTELLIGENCE_INTEGRITY_FAILURE',
    });
  }

  const storedVerificationState = row.verification_state;
  const verificationState = storedVerificationState === 'verified' ? 'unverified' : storedVerificationState;
  const trustReason = storedVerificationState === 'verified'
    ? 'Historical pre-finding evidence is treated conservatively as unverified in the handoff view; finding creation depends on the reproduced failure and observed evidence, not an upgraded trust claim.'
    : null;
  return {
    id: row.id,
    ...descriptor,
    systemSnapshotId: row.system_snapshot_id,
    controlId: row.entry_id,
    testExecutionId: row.test_execution_id || null,
    findingId: row.finding_id || null,
    evidenceClass: row.evidence_class,
    sourceType: row.source_type,
    sourceReference: row.source_reference,
    observedAt: row.observed_at,
    collectorId: row.collector_id || null,
    sensitivityClassification: row.sensitivity_classification,
    retentionStatus: row.retention_status,
    verificationState,
    limitations: row.limitations,
    integrityDigest: row.integrity_digest,
    ...(storedVerificationState !== verificationState ? { storedVerificationState } : {}),
    ...(trustReason ? { trustReason } : {}),
  };
}

async function historicalFailureEvidence(projectId, controlId, failure) {
  if (!failure?.id || !failure.systemSnapshotId) return [];
  const rows = await db.prepare(`SELECT e.* FROM control_evidence_items e
    JOIN control_test_executions t ON t.id=e.test_execution_id
      AND t.project_id=e.project_id
      AND t.system_snapshot_id=e.system_snapshot_id
      AND t.entry_id=e.entry_id
    WHERE e.project_id=? AND e.entry_id=? AND e.system_snapshot_id=? AND e.test_execution_id=?
      AND t.result='failed' AND t.execution_kind='initial'
    ORDER BY e.observed_at DESC LIMIT 50`)
    .all(projectId, controlId, failure.systemSnapshotId, failure.id);
  return rows.map(verifyAndSerializeHistoricalEvidence);
}

async function currentSnapshotId(projectId) {
  const row = await db.prepare("SELECT id FROM system_snapshots WHERE project_id=? AND status='current'").get(projectId);
  return row?.id || null;
}

async function unresolvedHistoricalFailureRows(projectId, snapshotId) {
  if (!projectId || !snapshotId) return [];
  return db.prepare(`SELECT t.id,t.entry_id,t.system_snapshot_id,t.finding_id,t.completed_at,r.status AS finding_status
    FROM control_test_executions t
    LEFT JOIN remediation_items r ON r.id=t.finding_id AND r.project_id=t.project_id
    WHERE t.project_id=? AND t.result='failed' AND t.execution_kind='initial' AND t.system_snapshot_id<>?
      AND (t.finding_id IS NULL OR r.id IS NULL OR r.status NOT IN ('verified_closed','accepted_risk'))
    ORDER BY t.completed_at ASC,t.id ASC`)
    .all(projectId, snapshotId);
}

async function historicalOpenFindings(projectId, snapshotId) {
  if (!projectId || !snapshotId) return [];
  return db.prepare(`SELECT DISTINCT r.id,r.title,r.severity,r.status,r.updated_at,b.entry_id,b.system_snapshot_id
    FROM remediation_items r
    JOIN control_finding_bindings b ON b.finding_id=r.id AND b.project_id=r.project_id
    WHERE r.project_id=? AND b.system_snapshot_id<>? AND r.status NOT IN ('verified_closed','accepted_risk')
    ORDER BY r.updated_at DESC,r.id DESC`)
    .all(projectId, snapshotId);
}

async function staleCurrentDeploymentDecision(projectId, userId, reassessmentTrigger, sourceType, sourceId) {
  const decisions = await db.prepare(`SELECT id,workspace_id,system_snapshot_id FROM control_deployment_decisions
    WHERE project_id=? AND status='current'`).all(projectId);
  if (!decisions.length) return 0;
  const timestamp = nowIso();
  await db.transaction(async () => {
    await db.prepare(`UPDATE control_deployment_decisions
      SET status='stale',reassessment_trigger=? WHERE project_id=? AND status='current'`)
      .run(reassessmentTrigger, projectId);
    for (const decision of decisions) {
      await db.prepare(`INSERT INTO security_audit_log
        (id,workspace_id,project_id,actor_type,actor_id,action,target_type,target_id,metadata_json,created_at)
        VALUES (?,?,?,?,?,?,?,?,?,?)`)
        .run(id('aud_'), decision.workspace_id, projectId, 'user', userId,
          'control_intelligence.deployment_decision_staled', 'deployment_decision', decision.id,
          JSON.stringify({ reassessmentTrigger, sourceType, sourceId, systemSnapshotId: decision.system_snapshot_id }), timestamp);
    }
  });
  return decisions.length;
}

async function staleIfHistoricalWrite(projectId, userId, snapshotId, trigger, sourceType, sourceId) {
  const current = await currentSnapshotId(projectId);
  if (!current || !snapshotId || snapshotId === current) return 0;
  return staleCurrentDeploymentDecision(projectId, userId, trigger, sourceType, sourceId);
}

function stageStates(currentStage, completedStages = [], notRequiredStages = []) {
  const completed = new Set(completedStages);
  const notRequired = new Set(notRequiredStages);
  return Object.fromEntries(STAGES.map((stage) => [
    stage,
    notRequired.has(stage) ? 'not_required' : completed.has(stage) ? 'complete' : stage === currentStage ? 'current' : 'blocked',
  ]));
}

function advanceHistoricalFailureToFinding(detail, history) {
  const qualifying = history.some((item) => item.retentionStatus === 'active'
    && ['unverified', 'verified'].includes(item.verificationState));
  if (!qualifying || detail.chain?.currentStage !== 'evidence') return detail;
  const completedStages = [...new Set([...(detail.chain.completedStages || []), 'applicability', 'test', 'evidence'])];
  const notRequiredStages = (detail.chain.notRequiredStages || []).filter((stage) => stage !== 'finding');
  const states = stageStates('finding', completedStages, notRequiredStages);
  const chain = {
    ...detail.chain,
    currentStage: 'finding',
    nextAction: 'Create or link a finding for the historical failed test.',
    deploymentImpact: 'blocker',
    chainStatus: 'test_failed',
    completedStages,
    notRequiredStages,
    stageStates: states,
    missingStages: ['finding'],
    missingRequirements: ['Create or link a finding for the historical failed test.'],
    blockedStages: STAGES.filter((stage) => states[stage] === 'blocked'),
    availableActions: ['create_finding'],
  };
  return { ...detail, chain };
}

function mergeEvidence(existing = [], historical = []) {
  const byId = new Map(existing.map((item) => [item.id, item]));
  for (const item of historical) if (!byId.has(item.id)) byId.set(item.id, item);
  return [...byId.values()].sort((a, b) => Date.parse(b.observedAt || 0) - Date.parse(a.observedAt || 0));
}

export async function getControlIntelligenceControl(args) {
  const detail = await getServiceControlIntelligenceControl(args);
  const failure = unresolvedHistoricalFailure(detail);
  if (!failure) return detail;
  const historical = await historicalFailureEvidence(args.projectId, args.controlId, failure);
  if (!historical.length) return detail;
  const withHistory = {
    ...detail,
    evidence: mergeEvidence(detail.evidence || [], historical),
    evidenceHistory: mergeEvidence(detail.evidenceHistory || [], historical),
  };
  return advanceHistoricalFailureToFinding(withHistory, historical);
}

export async function getControlIntelligence(args) {
  const result = await getServiceControlIntelligence(args);
  const snapshotId = result?.systemSnapshot?.id;
  if (!snapshotId || !result?.items?.length) return result;
  const historical = await unresolvedHistoricalFailureRows(args.projectId, snapshotId);
  if (!historical.length) return { ...result, summary: { ...result.summary, historicalUnresolvedFailures: 0, historicalFailureControls: 0 } };

  const affectedIds = new Set(historical.map((row) => row.entry_id));
  const untriagedIds = new Set(historical.filter((row) => !row.finding_id).map((row) => row.entry_id));
  let additionalBlockers = 0;
  for (const controlId of untriagedIds) {
    const baseline = await getServiceControlIntelligenceControl({ projectId: args.projectId, controlId, userId: args.userId });
    if (baseline.chain?.deploymentImpact !== 'blocker') additionalBlockers += 1;
  }

  let testsToRunDelta = 0;
  const items = [];
  for (const item of result.items) {
    if (!affectedIds.has(item.controlId)) {
      items.push(item);
      continue;
    }
    const detail = await getControlIntelligenceControl({ projectId: args.projectId, controlId: item.controlId, userId: args.userId });
    if (item.currentStage === 'test' && detail.chain?.currentStage !== 'test') testsToRunDelta -= 1;
    items.push({ ...item, ...detail.chain });
  }

  const summary = result.summary ? {
    ...result.summary,
    testsToRun: Math.max(0, Number(result.summary.testsToRun || 0) + testsToRunDelta),
    deploymentBlockers: Number(result.summary.deploymentBlockers || 0) + additionalBlockers,
    historicalUnresolvedFailures: historical.length,
    historicalFailureControls: affectedIds.size,
    historicalUntriagedFailures: historical.filter((row) => !row.finding_id).length,
  } : result.summary;
  return { ...result, items, summary };
}

export async function getControlIntelligenceReportSummary(args) {
  const report = await getServiceControlIntelligenceReportSummary(args);
  const snapshotId = report?.systemSnapshot?.id;
  if (!snapshotId) return report;
  const [failures, findings] = await Promise.all([
    unresolvedHistoricalFailureRows(args.projectId, snapshotId),
    historicalOpenFindings(args.projectId, snapshotId),
  ]);
  const untriaged = failures.filter((row) => !row.finding_id).map((row) => ({
    testExecutionId: row.id,
    controlId: row.entry_id,
    failedSnapshotId: row.system_snapshot_id,
    completedAt: row.completed_at,
    status: 'reproduced_failure_requires_triage',
  }));
  const historicalFindings = findings.map((row) => ({
    id: row.id,
    controlId: row.entry_id,
    failedSnapshotId: row.system_snapshot_id,
    title: row.title,
    status: row.status,
    contextualSeverity: row.severity || null,
    updatedAt: row.updated_at,
  }));
  const pending = untriaged.length + historicalFindings.length;
  const limitation = 'Unresolved reproduced failures and findings from superseded snapshots remain historical provenance and continue to block or hold deployment until triaged, remediated and retested; they are not rewritten onto the current snapshot.';
  return {
    ...report,
    historicalRiskPending: pending > 0,
    historicalUntriagedFailures: untriaged,
    historicalOpenFindings: historicalFindings,
    limitations: pending ? [...new Set([...(report.limitations || []), limitation])] : report.limitations,
  };
}

export async function recordControlEvidence(args) {
  const result = await recordServiceControlEvidence(args);
  await staleIfHistoricalWrite(args.projectId, args.userId, result?.systemSnapshotId,
    'historical_failure_evidence', 'control_evidence', result?.id || null);
  return result;
}

export async function createControlFinding(args) {
  const result = await createServiceControlFinding(args);
  await staleIfHistoricalWrite(args.projectId, args.userId, result?.snapshotId,
    'historical_failure_finding', 'remediation', result?.id || null);
  return result;
}

export async function recordDeploymentDecision(args) {
  const snapshotId = await currentSnapshotId(args.projectId);
  if (snapshotId) {
    const historical = await unresolvedHistoricalFailureRows(args.projectId, snapshotId);
    const untriaged = historical.filter((row) => !row.finding_id);
    if (untriaged.length) {
      throw Object.assign(new Error(`Deployment decision blocked: ${untriaged.length} reproduced failure${untriaged.length === 1 ? '' : 's'} from superseded system snapshots still require evidence and finding triage before a current deployment decision can be recorded.`), { statusCode: 409 });
    }
  }
  return recordServiceDeploymentDecision(args);
}
