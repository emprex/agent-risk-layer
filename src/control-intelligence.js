import { db } from './db.js';
import { intelligenceDigest } from './control-intelligence-core.js';
import { getControlIntelligenceControl as getServiceControlIntelligenceControl } from './control-intelligence-service.js';

export * from './control-intelligence-service.js';

const CLOSED_FINDING_STATES = new Set(['verified_closed', 'accepted_risk']);
const STAGES = ['applicability', 'test', 'evidence', 'finding', 'remediation', 'retest', 'approval', 'deployment_decision'];

function parseJson(value, fallback = null) {
  try { return JSON.parse(value); } catch { return fallback; }
}

function unresolvedHistoricalFailure(detail) {
  if ((detail.findings || []).some((item) => !CLOSED_FINDING_STATES.has(item.status))) return null;
  const closedIds = new Set((detail.findings || [])
    .filter((item) => CLOSED_FINDING_STATES.has(item.status))
    .map((item) => item.id));
  const currentSnapshotId = detail.systemSnapshot?.id;
  const tests = [...(detail.testHistory || []), ...(detail.tests || [])];
  const seen = new Set();
  return tests.find((item) => {
    if (!item?.id || seen.has(item.id)) return false;
    seen.add(item.id);
    return item.result === 'failed'
      && item.executionKind !== 'retest'
      && item.systemSnapshotId
      && item.systemSnapshotId !== currentSnapshotId
      && (!item.findingId || !closedIds.has(item.findingId));
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
  const chain = {
    ...detail.chain,
    currentStage: 'finding',
    nextAction: 'Create or link a finding for the historical failed test.',
    deploymentImpact: 'blocker',
    chainStatus: 'test_failed',
    completedStages,
    notRequiredStages,
    stageStates: stageStates('finding', completedStages, notRequiredStages),
    missingStages: ['finding'],
    missingRequirements: ['Create or link a finding for the historical failed test.'],
    blockedStages: STAGES.filter((stage) => stageStates('finding', completedStages, notRequiredStages)[stage] === 'blocked'),
    availableActions: ['create_finding'],
  };
  return { ...detail, chain };
}

export async function getControlIntelligenceControl(args) {
  const detail = await getServiceControlIntelligenceControl(args);
  const failure = unresolvedHistoricalFailure(detail);
  if (!failure) return detail;
  const historical = await historicalFailureEvidence(args.projectId, args.controlId, failure);
  if (!historical.length) return detail;
  const existingIds = new Set((detail.evidenceHistory || []).map((item) => item.id));
  const evidenceHistory = [...(detail.evidenceHistory || []), ...historical.filter((item) => !existingIds.has(item.id))]
    .sort((a, b) => Date.parse(b.observedAt || 0) - Date.parse(a.observedAt || 0));
  return advanceHistoricalFailureToFinding({ ...detail, evidenceHistory }, historical);
}
