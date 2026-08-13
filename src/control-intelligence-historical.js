import { db, id, nowIso } from './db.js';
import { canonicalJson, intelligenceDigest } from './control-intelligence-core.js';

const RECORD_ROLES = new Set(['analyst', 'developer', 'admin', 'owner']);
const SENSITIVITY = new Set(['public', 'internal', 'confidential', 'restricted']);
const SECRET_KEY = /(?:password|secret|token|api.?key|private.?key|credential)/i;
const SECRET_VALUE = /(?:arl_live_[a-z0-9_\-]{12,}|\bBearer\s+[A-Za-z0-9._~+\/-]{16,}|\bsk-(?:proj-)?[A-Za-z0-9_-]{12,})/i;

function error(message, statusCode = 409) {
  return Object.assign(new Error(message), { statusCode });
}

function clean(value, max = 200) {
  return String(value ?? '').trim().slice(0, max);
}

function parseJson(value, fallback = null) {
  try { return JSON.parse(value); } catch { return fallback; }
}

function parseTime(value) {
  if (!value) return null;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function safeTime(value) {
  const parsed = parseTime(value);
  return parsed == null ? null : new Date(parsed).toISOString();
}

function rejectSensitive(value, path = '') {
  if (typeof value === 'string') {
    if (SECRET_VALUE.test(value)) throw error(`Secret-like value${path ? ` at ${path}` : ''} cannot be stored.`, 400);
    return;
  }
  if (!value || typeof value !== 'object') return;
  for (const [key, item] of Object.entries(value)) {
    const next = path ? `${path}.${key}` : key;
    if (SECRET_KEY.test(key)) throw error(`Sensitive field ${next} cannot be stored in an evidence descriptor.`, 400);
    rejectSensitive(item, next);
  }
}

async function requireRecordAccess(projectId, userId, lock = false) {
  const suffix = lock && db.kind === 'postgres' ? ' FOR UPDATE OF p' : '';
  const row = await db.prepare(`SELECT p.*,m.role FROM security_projects p JOIN workspace_members m ON m.workspace_id=p.workspace_id
    WHERE p.id=? AND m.user_id=? AND m.status='active'${suffix}`).get(clean(projectId, 100), userId);
  if (!row || !RECORD_ROLES.has(row.role)) throw error('Project not found or permission denied.', 403);
  return { project: row, role: row.role };
}

async function currentSnapshot(access) {
  return db.prepare("SELECT * FROM system_snapshots WHERE workspace_id=? AND project_id=? AND status='current'")
    .get(access.project.workspace_id, access.project.id);
}

async function exactSnapshot(access, snapshotId) {
  return db.prepare('SELECT * FROM system_snapshots WHERE id=? AND workspace_id=? AND project_id=?')
    .get(clean(snapshotId, 100), access.project.workspace_id, access.project.id);
}

async function failedInitialExecution(access, controlId, executionId) {
  return db.prepare(`SELECT * FROM control_test_executions
    WHERE id=? AND workspace_id=? AND project_id=? AND entry_id=? AND result='failed' AND execution_kind='initial'`)
    .get(clean(executionId, 100), access.project.workspace_id, access.project.id, clean(controlId, 80));
}

async function audit(access, userId, action, targetType, targetId, metadata = {}) {
  await db.prepare(`INSERT INTO security_audit_log
    (id,workspace_id,project_id,actor_type,actor_id,action,target_type,target_id,metadata_json,created_at)
    VALUES (?,?,?,?,?,?,?,?,?,?)`)
    .run(id('aud_'), access.project.workspace_id, access.project.id, 'user', userId, action, targetType, targetId, JSON.stringify(metadata), nowIso());
}

function verifyHistoricalTest(row) {
  const descriptor = parseJson(row?.descriptor_json, null);
  if (!descriptor || intelligenceDigest(descriptor) !== row.content_digest) {
    throw error('Historical failed test integrity verification failed.', 503);
  }
  if (descriptor.workspaceId !== row.workspace_id
    || descriptor.projectId !== row.project_id
    || descriptor.systemSnapshotId !== row.system_snapshot_id
    || descriptor.entryId !== row.entry_id
    || descriptor.result !== row.result
    || descriptor.executionKind !== row.execution_kind
    || (descriptor.findingId || null) !== (row.finding_id || null)) {
    throw error('Historical failed test provenance does not match its stored descriptor.', 503);
  }
}

function verifyHistoricalEvidence(row) {
  const descriptor = parseJson(row?.descriptor_json, null);
  if (!descriptor || intelligenceDigest(descriptor) !== row.integrity_digest) {
    throw error('Historical failure evidence integrity verification failed.', 503);
  }
  if (descriptor.workspaceId !== row.workspace_id
    || descriptor.projectId !== row.project_id
    || descriptor.systemSnapshotId !== row.system_snapshot_id
    || descriptor.controlId !== row.entry_id
    || (descriptor.testExecutionId || null) !== (row.test_execution_id || null)
    || descriptor.evidenceClass !== row.evidence_class
    || descriptor.sourceType !== row.source_type
    || descriptor.sourceReference !== row.source_reference
    || descriptor.verificationState !== row.verification_state
    || descriptor.retentionStatus !== row.retention_status) {
    throw error('Historical failure evidence provenance does not match its stored descriptor.', 503);
  }
}

export async function maybeRecordHistoricalFailureEvidence({ projectId, controlId, userId, input = {} }) {
  if (!input.testExecutionId) return { handled: false };
  const access = await requireRecordAccess(projectId, userId);
  const execution = await failedInitialExecution(access, controlId, input.testExecutionId);
  if (!execution) return { handled: false };
  const current = await currentSnapshot(access);
  if (!current || execution.system_snapshot_id === current.id) return { handled: false };

  const snapshot = await exactSnapshot(access, input.systemSnapshotId);
  if (!snapshot || snapshot.id !== execution.system_snapshot_id || snapshot.status !== 'superseded') {
    throw error('Historical failure evidence must remain bound to the exact superseded snapshot where the failure was reproduced.');
  }
  if (input.redteamRunId || input.redteamBaselineRunId || input.redteamCaseId
    || input.runtimeEventId || input.approvalId || input.remediationArtifactId
    || input.findingId || input.remediationId) {
    throw error('Historical pre-finding evidence can only bind the observed failed test. Runtime, approval, remediation and Red Team bindings require their dedicated current-snapshot workflows.', 400);
  }
  if (clean(input.evidenceClass, 30) !== 'observed') {
    throw error('Historical failed-test handoff accepts observed evidence only.', 400);
  }
  const sourceType = clean(input.sourceType, 40);
  const sourceReference = clean(input.sourceReference, 300);
  if (!sourceType || !sourceReference) throw error('Evidence source type and privacy-safe reference are required.', 400);
  verifyHistoricalTest(execution);

  const completedAt = parseTime(execution.completed_at);
  if (completedAt == null) throw error('Historical failed test does not have a valid completion timestamp.', 503);
  const observedAt = input.observedAt ? safeTime(input.observedAt) : new Date(completedAt).toISOString();
  if (!observedAt) throw error('Evidence observedAt must be a valid timestamp.', 400);
  if (parseTime(observedAt) < completedAt) throw error('Evidence observedAt cannot precede completion of the linked historical test.');

  const timestamp = nowIso();
  const descriptor = {
    schema: 'arl.control-evidence.v2',
    workspaceId: access.project.workspace_id,
    projectId: access.project.id,
    systemSnapshotId: snapshot.id,
    controlId: clean(controlId, 80),
    evidenceClass: 'observed',
    sourceType,
    sourceReference,
    testExecutionId: execution.id,
    runtimeEventId: null,
    approvalId: null,
    remediationArtifactId: null,
    findingId: null,
    remediationId: null,
    observedAt,
    collectorId: userId,
    sourceDigest: null,
    sensitivityClassification: SENSITIVITY.has(input.sensitivityClassification) ? input.sensitivityClassification : 'internal',
    retentionStatus: 'active',
    verificationState: 'unverified',
    limitations: clean(input.limitations, 2000),
  };
  rejectSensitive(descriptor);
  const evidenceId = id('cei_');
  const integrityDigest = intelligenceDigest(descriptor);
  await db.prepare(`INSERT INTO control_evidence_items
    (id,workspace_id,project_id,system_snapshot_id,entry_id,test_execution_id,finding_id,evidence_class,source_type,source_reference,runtime_event_id,approval_id,remediation_artifact_id,remediation_id,observed_at,collector_id,integrity_digest,descriptor_json,sensitivity_classification,retention_status,verification_state,limitations,created_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`)
    .run(evidenceId, access.project.workspace_id, access.project.id, snapshot.id, clean(controlId, 80), execution.id,
      null, 'observed', sourceType, sourceReference, null, null, null, null, observedAt, userId,
      integrityDigest, canonicalJson(descriptor), descriptor.sensitivityClassification, 'active', 'unverified', descriptor.limitations, timestamp);
  await audit(access, userId, 'control_intelligence.historical_failure_evidence_recorded', 'control_evidence', evidenceId, {
    controlId: clean(controlId, 80),
    testExecutionId: execution.id,
    historicalSnapshotId: snapshot.id,
    currentSnapshotId: current.id,
    verificationState: 'unverified',
    integrityDigest,
  });
  return { handled: true, result: { id: evidenceId, ...descriptor, integrityDigest, retentionStatus: 'active' } };
}

export async function maybeCreateHistoricalControlFinding({ projectId, controlId, userId, input = {} }) {
  if (!input.testExecutionId) return { handled: false };
  let output = { handled: false };
  await db.transaction(async () => {
    const access = await requireRecordAccess(projectId, userId, true);
    const execution = await failedInitialExecution(access, controlId, input.testExecutionId);
    if (!execution) return;
    const current = await currentSnapshot(access);
    if (!current || execution.system_snapshot_id === current.id) return;
    const snapshot = await exactSnapshot(access, input.systemSnapshotId);
    if (!snapshot || snapshot.id !== execution.system_snapshot_id || snapshot.status !== 'superseded') {
      throw error('Historical finding creation must remain bound to the exact superseded snapshot where the failed test was reproduced.');
    }
    verifyHistoricalTest(execution);
    if (execution.finding_id) throw error('A finding already exists for this failed execution.');

    const failureEvidence = await db.prepare(`SELECT * FROM control_evidence_items
      WHERE workspace_id=? AND project_id=? AND system_snapshot_id=? AND entry_id=? AND test_execution_id=?
        AND retention_status='active' AND verification_state IN ('unverified','verified')
      ORDER BY observed_at DESC LIMIT 1`)
      .get(access.project.workspace_id, access.project.id, snapshot.id, clean(controlId, 80), execution.id);
    if (!failureEvidence) throw error('Attach active observed evidence to the historical failed test before creating a finding.');
    verifyHistoricalEvidence(failureEvidence);

    const title = clean(input.title, 240);
    const narrative = clean(input.narrative, 2000);
    const impact = clean(input.impact, 2000);
    if (title.length < 3 || narrative.length < 10 || impact.length < 5) {
      throw error('Finding title, what happened and impact are required.', 400);
    }
    const { impactFacts: rawImpactFacts, ...customerFields } = input;
    rejectSensitive(customerFields);
    const allowedImpactFacts = ['crossTenantAccess', 'secretExposure', 'financialAction', 'administrativeAction', 'irreversibleSideEffect', 'approvalBypass', 'availabilityImpact'];
    const suppliedFlags = rawImpactFacts && typeof rawImpactFacts === 'object' ? rawImpactFacts : {};
    const flags = Object.fromEntries(allowedImpactFacts.filter((key) => suppliedFlags[key] === true).map((key) => [key, true]));
    const severe = ['crossTenantAccess', 'secretExposure', 'financialAction', 'administrativeAction', 'irreversibleSideEffect', 'approvalBypass'].filter((key) => flags[key]);
    const severity = severe.length >= 2 ? 'critical' : severe.length === 1 ? 'high' : flags.availabilityImpact ? 'medium' : 'low';

    const findingId = id('rem_');
    const timestamp = nowIso();
    const findingKey = `${clean(controlId, 80)}-${execution.id}`;
    const verification = {
      schema: 'arl.control-finding.v1',
      failedExecutionId: execution.id,
      expectedResult: execution.expected_result,
      observedResult: execution.observed_result,
      narrative,
      affectedAsset: clean(input.affectedAsset, 500),
      impact,
      sideEffectOutcome: clean(input.sideEffectOutcome, 50),
      reproductionSummary: clean(input.reproductionSummary, 1000),
      containment: clean(input.containment, 1000),
      limitations: clean(input.limitations, 1000),
      impactFacts: Object.keys(flags),
      creatorId: userId,
      createdAt: timestamp,
    };
    verification.integrityDigest = intelligenceDigest(verification);
    await db.prepare(`INSERT INTO remediation_items
      (id,project_id,finding_key,title,severity,status,owner_email,due_at,verification_json,created_by,created_at,updated_at)
      VALUES (?,?,?,?,?,'open',?,?,?,?,?,?)`)
      .run(findingId, access.project.id, findingKey, title, severity, clean(input.ownerEmail, 254) || null, safeTime(input.dueAt), JSON.stringify(verification), userId, timestamp, timestamp);

    const bindingDescriptor = {
      schema: 'arl.control-finding-binding.v1',
      workspaceId: access.project.workspace_id,
      projectId: access.project.id,
      systemSnapshotId: snapshot.id,
      entryId: clean(controlId, 80),
      findingId,
      bindingMethod: 'failed_test',
      confirmationMethod: 'customer_confirmed',
      boundBy: userId,
      createdAt: timestamp,
    };
    const sourceDigest = intelligenceDigest({ id: findingId, projectId: access.project.id, findingKey, title, status: 'open', createdAt: timestamp });
    await db.prepare(`INSERT INTO control_finding_bindings
      (id,workspace_id,project_id,system_snapshot_id,entry_id,finding_id,source_digest,binding_method,bound_by,descriptor_json,content_digest,created_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`)
      .run(id('cfb_'), access.project.workspace_id, access.project.id, snapshot.id, clean(controlId, 80), findingId,
        sourceDigest, 'failed_test', userId, canonicalJson(bindingDescriptor), intelligenceDigest(bindingDescriptor), timestamp);

    const executionDescriptor = { ...parseJson(execution.descriptor_json, {}), findingId };
    await db.prepare('UPDATE control_test_executions SET finding_id=?,descriptor_json=?,content_digest=? WHERE id=? AND project_id=?')
      .run(findingId, canonicalJson(executionDescriptor), intelligenceDigest(executionDescriptor), execution.id, access.project.id);
    await audit(access, userId, 'control_intelligence.historical_finding_created', 'remediation', findingId, {
      controlId: clean(controlId, 80),
      testExecutionId: execution.id,
      historicalSnapshotId: snapshot.id,
      currentSnapshotId: current.id,
      severityStatus: 'evaluated',
      contextualSeverity: severity,
    });
    output = {
      handled: true,
      result: {
        id: findingId,
        title,
        status: 'open',
        contextualSeverity: severity,
        severityStatus: 'evaluated',
        failedTestExecutionId: execution.id,
        snapshotId: snapshot.id,
        controlId: clean(controlId, 80),
        owner: clean(input.ownerEmail, 254) || null,
        createdAt: timestamp,
      },
    };
  });
  return output;
}

export async function remediationSnapshotState({ projectId, currentSnapshotId, failedSnapshotId, findingId }) {
  if (!projectId || !currentSnapshotId || !failedSnapshotId || !findingId) {
    return { implementationRecorded: false, remediatedSnapshotReady: false };
  }
  const [snapshot, artifact] = await Promise.all([
    db.prepare('SELECT id,project_id,created_at FROM system_snapshots WHERE id=? AND project_id=?').get(clean(currentSnapshotId, 100), clean(projectId, 100)),
    db.prepare("SELECT id,created_at FROM remediation_evidence_artifacts WHERE project_id=? AND remediation_id=? AND artifact_type='implementation' AND lifecycle_state='active' AND invalidated_at IS NULL ORDER BY created_at DESC LIMIT 1")
      .get(clean(projectId, 100), clean(findingId, 100)),
  ]);
  if (!artifact) return { implementationRecorded: false, remediatedSnapshotReady: false };
  const snapshotCreated = parseTime(snapshot?.created_at);
  const implementationCreated = parseTime(artifact.created_at);
  return {
    implementationRecorded: true,
    implementationArtifactId: artifact.id,
    implementationCreatedAt: artifact.created_at,
    snapshotCreatedAt: snapshot?.created_at || null,
    remediatedSnapshotReady: Boolean(snapshot
      && currentSnapshotId !== failedSnapshotId
      && snapshotCreated != null
      && implementationCreated != null
      && snapshotCreated >= implementationCreated),
  };
}

export async function assertRetestSnapshotAfterImplementation({ projectId, controlId, userId, input = {} }) {
  if (clean(input.executionKind, 20) !== 'retest') return;
  const access = await requireRecordAccess(projectId, userId);
  const original = await failedInitialExecution(access, controlId, input.retestOfExecutionId);
  if (!original) return;
  const target = await exactSnapshot(access, input.systemSnapshotId);
  const artifact = await db.prepare("SELECT id,created_at FROM remediation_evidence_artifacts WHERE workspace_id=? AND project_id=? AND remediation_id=? AND artifact_type='implementation' AND lifecycle_state='active' AND invalidated_at IS NULL ORDER BY created_at DESC LIMIT 1")
    .get(access.project.workspace_id, access.project.id, clean(input.remediationId || input.findingId, 100));
  if (!artifact || !target) return;
  const targetCreated = parseTime(target.created_at);
  const implementationCreated = parseTime(artifact.created_at);
  if (target.id === original.system_snapshot_id
    || targetCreated == null
    || implementationCreated == null
    || targetCreated < implementationCreated) {
    throw error('Retest target snapshot must be a changed system snapshot created after the remediation implementation evidence. Historical or pre-fix snapshots cannot prove the fix.');
  }
}
