import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { db, nowIso } from '../src/db.js';
import { createWorkspace } from '../src/workspaces.js';
import { createSecurityProject } from '../src/control-plane.js';
import {
  applyProjectRiskKnowledgeProfile,
  getProjectEvidenceReadiness,
  getPublicRiskKnowledgeEntry,
  getRiskKnowledgeEntry,
  linkRiskKnowledge,
  listRiskKnowledge,
  prepareRiskKnowledgeRuntimeEvidencePurge,
  profileRiskKnowledge,
  setProjectRiskKnowledgeState,
} from '../src/risk-knowledge.js';
import { resolveRiskKnowledgeSubject } from '../src/risk-knowledge-subjects.js';
import { enforceRetention } from '../src/retention.js';

function randomId(prefix) { return `${prefix}${crypto.randomUUID().replaceAll('-', '')}`; }
function digest(value) { return crypto.createHash('sha256').update(String(value)).digest('hex'); }

async function createUser(label = 'risk') {
  const userId = randomId('usr_');
  const timestamp = nowIso();
  await db.prepare('INSERT INTO users (id,email,password_hash,created_at,email_verified_at) VALUES (?,?,?,?,?)')
    .run(userId, `${label}-${crypto.randomUUID()}@example.test`, 'test-only', timestamp, timestamp);
  return userId;
}

async function fixture(label = 'risk') {
  const userId = await createUser(label);
  const workspace = await createWorkspace(userId, `${label} workspace`);
  const project = await createSecurityProject({ userId, workspaceId: workspace.id, name: `${label} agent`, environment: 'production' });
  return { userId, workspace, project };
}

async function insertRuntimeEvent(projectId, { id = randomId('rte_'), createdAt = nowIso(), retest = null } = {}) {
  await db.prepare(`INSERT INTO runtime_events
    (id,project_id,request_id,event_type,decision,observed_decision,severity,rule_ids_json,evaluation_ms,metadata_json,response_json,
      policy_version,policy_digest,policy_published_at,retest_criteria_id,remediation_id,retest_criteria_digest,retest_satisfied,created_at)
    VALUES (?,?,?,'guard','deny','deny','critical','[]',1,'{}','{}','1',?,?,?, ?,?,?,?)`)
    .run(id, projectId, randomId('req_'), digest('policy'), createdAt, retest?.criteriaId || null, retest?.remediationId || null,
      retest?.criteriaDigest || null, retest?.satisfied ? 1 : retest ? 0 : null, createdAt);
  return id;
}

test('risk knowledge seed, public boundary, profiling and project state are integrated', async () => {
  const entries = await listRiskKnowledge({ limit: 250 });
  assert.equal(entries.length, 108);
  assert.equal(entries.some((entry) => Object.hasOwn(entry, 'checks')), false);
  assert.equal(entries.some((entry) => entry.operationalMetadata?.machineRule), false);

  const publicEntry = await getPublicRiskKnowledgeEntry('ARL-KB-053');
  assert.equal(publicEntry.id, 'ARL-KB-053');
  assert.equal(Object.hasOwn(publicEntry, 'checks'), false);
  assert.equal(Object.hasOwn(publicEntry.operationalMetadata || {}, 'machineRule'), false);

  const detailed = await getRiskKnowledgeEntry('ARL-KB-053');
  assert.equal(detailed.checks.length, 1);
  assert.equal(detailed.solutions.length, 1);
  assert.match(detailed.checks[0].passCondition, /.+/);

  const profile = await profileRiskKnowledge({ uses_tools: true, is_production: true });
  assert.equal(profile.length, 108);
  assert.equal(profile.find((item) => item.entry.id === 'ARL-KB-053').applicability.status, 'applicable');
  assert.ok(profile.some((item) => item.applicability.status === 'unknown'));

  const { userId, workspace, project } = await fixture('profile');
  const applied = await applyProjectRiskKnowledgeProfile({
    workspaceId: workspace.id,
    projectId: project.id,
    architectureFacts: { uses_tools: true, is_production: true },
    userId,
  });
  assert.equal(applied.results.length, 108);
  assert.equal(applied.summary.total, 108);
  assert.equal(applied.summary.deploymentGate, 'review_required');
  const readiness = await getProjectEvidenceReadiness({ workspaceId: workspace.id, projectId: project.id });
  assert.equal(readiness.states.length, 108);
  assert.equal(readiness.states.find((state) => state.entryId === 'ARL-KB-053').applicabilityStatus, 'applicable');
});

test('evidence links are tenant-bound and state advancement requires authoritative evidence', async () => {
  const first = await fixture('first');
  const second = await fixture('second');
  await applyProjectRiskKnowledgeProfile({
    workspaceId: first.workspace.id,
    projectId: first.project.id,
    architectureFacts: { uses_tools: true },
    userId: first.userId,
  });

  const eventId = await insertRuntimeEvent(first.project.id);
  assert.equal(await resolveRiskKnowledgeSubject({
    workspaceId: second.workspace.id,
    projectId: second.project.id,
    subjectType: 'runtime_event',
    subjectId: eventId,
  }), null);

  await assert.rejects(() => setProjectRiskKnowledgeState({
    workspaceId: first.workspace.id,
    projectId: first.project.id,
    entryId: 'ARL-KB-053',
    evidenceState: 'finding_open',
    stateReason: 'No authoritative finding evidence is linked yet.',
    userId: first.userId,
  }), /requires a linked authoritative record/i);

  const link = await linkRiskKnowledge({
    workspaceId: first.workspace.id,
    projectId: first.project.id,
    subjectType: 'runtime_event',
    subjectId: eventId,
    entryId: 'ARL-KB-053',
    linkRole: 'primary',
    userId: first.userId,
    subjectResolver: resolveRiskKnowledgeSubject,
  });
  assert.equal(link.duplicate, false);
  const duplicate = await linkRiskKnowledge({
    workspaceId: first.workspace.id,
    projectId: first.project.id,
    subjectType: 'runtime_event',
    subjectId: eventId,
    entryId: 'ARL-KB-053',
    linkRole: 'primary',
    userId: first.userId,
    subjectResolver: resolveRiskKnowledgeSubject,
  });
  assert.equal(duplicate.duplicate, true);

  const open = await setProjectRiskKnowledgeState({
    workspaceId: first.workspace.id,
    projectId: first.project.id,
    entryId: 'ARL-KB-053',
    evidenceState: 'finding_open',
    stateReason: 'A project-bound runtime denial reproduces the critical authority failure.',
    userId: first.userId,
  });
  assert.equal(open.criticalGateFailed, true);
  assert.equal(open.deploymentGate, 'do_not_deploy');

  const attemptedScopeRemoval = await applyProjectRiskKnowledgeProfile({
    workspaceId: first.workspace.id,
    projectId: first.project.id,
    architectureFacts: { uses_tools: false },
    userId: first.userId,
  });
  const protectedFinding = attemptedScopeRemoval.results.find((item) => item.entryId === 'ARL-KB-053');
  assert.equal(protectedFinding.applicabilityStatus, 'applicable');
  assert.equal(protectedFinding.evidenceState, 'finding_open');
  assert.equal(protectedFinding.criticalGateFailed, true);
  assert.equal(protectedFinding.deploymentGate, 'do_not_deploy');

  const approvalId = randomId('apr_');
  const timestamp = nowIso();
  await db.prepare(`INSERT INTO runtime_approvals
    (id,workspace_id,project_id,approver_id,tool_name,environment,action_digest,token_digest,status,issued_at,expires_at)
    VALUES (?,?,?,?,?,?,?,?,'active',?,?)`)
    .run(approvalId, first.workspace.id, first.project.id, first.userId, 'refund_order', 'production', digest('action'), digest('token'), timestamp,
      new Date(Date.now() + 600000).toISOString());
  await linkRiskKnowledge({
    workspaceId: first.workspace.id,
    projectId: first.project.id,
    subjectType: 'approval',
    subjectId: approvalId,
    entryId: 'ARL-KB-053',
    linkRole: 'related',
    userId: first.userId,
    subjectResolver: resolveRiskKnowledgeSubject,
  });
  await assert.rejects(() => setProjectRiskKnowledgeState({
    workspaceId: first.workspace.id,
    projectId: first.project.id,
    entryId: 'ARL-KB-053',
    evidenceState: 'risk_accepted',
    stateReason: 'A runtime action approval must not be treated as risk acceptance.',
    userId: first.userId,
  }), /requires a linked authoritative record/i);

  const implementationRemediationId = randomId('rem_');
  const snapshotId = randomId('ast_');
  const artifactId = randomId('rea_');
  await db.prepare(`INSERT INTO remediation_items
    (id,project_id,finding_key,title,severity,status,verification_json,created_by,created_at,updated_at)
    VALUES (?,?,?,?,?,'open','{}',?,?,?)`)
    .run(implementationRemediationId, first.project.id, 'ARL-KB-054-test', 'Constrain tool inputs', 'critical', first.userId, timestamp, timestamp);
  await db.prepare(`INSERT INTO asset_snapshots
    (id,project_id,source,source_digest,summary_json,assets_json,drift_json,created_by,created_at)
    VALUES (?,?,'manual',?,'{}','[]','{}',?,?)`)
    .run(snapshotId, first.project.id, digest('snapshot'), first.userId, timestamp);
  await db.prepare(`INSERT INTO remediation_evidence_artifacts
    (id,workspace_id,project_id,remediation_id,artifact_type,source_type,source_id,lifecycle_state,content_json,content_digest,created_by,created_at)
    VALUES (?,?,?,?, 'implementation','asset_snapshot',?,'active','{}',?,?,?)`)
    .run(artifactId, first.workspace.id, first.project.id, implementationRemediationId, snapshotId, digest('artifact'), first.userId, timestamp);
  await linkRiskKnowledge({ workspaceId: first.workspace.id, projectId: first.project.id, subjectType: 'evidence_artifact', subjectId: artifactId,
    entryId: 'ARL-KB-054', linkRole: 'control', userId: first.userId, subjectResolver: resolveRiskKnowledgeSubject });
  await setProjectRiskKnowledgeState({ workspaceId: first.workspace.id, projectId: first.project.id, entryId: 'ARL-KB-054',
    evidenceState: 'declared', stateReason: 'The control is declared but not yet observed.', userId: first.userId });
  await setProjectRiskKnowledgeState({ workspaceId: first.workspace.id, projectId: first.project.id, entryId: 'ARL-KB-054',
    evidenceState: 'observed', stateReason: 'A project-bound implementation artifact was observed.', userId: first.userId });
  await assert.rejects(() => setProjectRiskKnowledgeState({
    workspaceId: first.workspace.id,
    projectId: first.project.id,
    entryId: 'ARL-KB-054',
    evidenceState: 'test_passed',
    stateReason: 'A generic implementation artifact is not enough to claim a test passed.',
    userId: first.userId,
  }), /requires a linked authoritative record/i);
});

test('retest evidence must be completed, passed and remains valid only while its runtime source is retained', async () => {
  const { userId, workspace, project } = await fixture('retest');
  await applyProjectRiskKnowledgeProfile({ workspaceId: workspace.id, projectId: project.id, architectureFacts: { uses_tools: true }, userId });
  const findingEventId = await insertRuntimeEvent(project.id);
  await linkRiskKnowledge({ workspaceId: workspace.id, projectId: project.id, subjectType: 'runtime_event', subjectId: findingEventId,
    entryId: 'ARL-KB-053', linkRole: 'primary', userId, subjectResolver: resolveRiskKnowledgeSubject });
  await setProjectRiskKnowledgeState({ workspaceId: workspace.id, projectId: project.id, entryId: 'ARL-KB-053', evidenceState: 'finding_open',
    stateReason: 'Critical runtime finding reproduced.', userId });

  const remediationId = randomId('rem_');
  const timestamp = nowIso();
  await db.prepare(`INSERT INTO remediation_items
    (id,project_id,finding_key,title,severity,status,verification_json,created_by,created_at,updated_at)
    VALUES (?,?,?,?,?,'open','{}',?,?,?)`)
    .run(remediationId, project.id, 'ARL-KB-053-test', 'Reduce tool authority', 'critical', userId, timestamp, timestamp);
  await linkRiskKnowledge({ workspaceId: workspace.id, projectId: project.id, subjectType: 'remediation', subjectId: remediationId,
    entryId: 'ARL-KB-053', linkRole: 'control', userId, subjectResolver: resolveRiskKnowledgeSubject });
  await setProjectRiskKnowledgeState({ workspaceId: workspace.id, projectId: project.id, entryId: 'ARL-KB-053', evidenceState: 'remediation_in_progress',
    stateReason: 'Least-privilege remediation is being implemented.', userId });

  const criteriaId = randomId('rtc_');
  const criteriaDigest = digest('criteria');
  await db.prepare(`INSERT INTO remediation_retest_criteria
    (id,workspace_id,project_id,remediation_id,finding_key,rule_id,expected_decision,action_type,target_identity,
      policy_version,policy_digest,policy_published_at,criteria_digest,status,created_by,created_at,expires_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,'active',?,?,?)`)
    .run(criteriaId, workspace.id, project.id, remediationId, 'ARL-KB-053-test', 'ARL-RUN-009', 'deny', 'tool_call', 'refund_order',
      '1', digest('policy'), timestamp, criteriaDigest, userId, timestamp, new Date(Date.now() + 600000).toISOString());
  await assert.rejects(() => linkRiskKnowledge({ workspaceId: workspace.id, projectId: project.id, subjectType: 'retest', subjectId: criteriaId,
    entryId: 'ARL-KB-053', linkRole: 'retest', userId, subjectResolver: resolveRiskKnowledgeSubject }), /not found in this project/i);

  const retestEventId = await insertRuntimeEvent(project.id, { retest: { criteriaId, remediationId, criteriaDigest, satisfied: true } });
  await db.prepare(`UPDATE remediation_retest_criteria SET status='completed',consumed_at=?,runtime_event_id=?,result='passed' WHERE id=?`)
    .run(nowIso(), retestEventId, criteriaId);
  await linkRiskKnowledge({ workspaceId: workspace.id, projectId: project.id, subjectType: 'retest', subjectId: criteriaId,
    entryId: 'ARL-KB-053', linkRole: 'retest', userId, subjectResolver: resolveRiskKnowledgeSubject });
  const passed = await setProjectRiskKnowledgeState({ workspaceId: workspace.id, projectId: project.id, entryId: 'ARL-KB-053', evidenceState: 'retest_passed',
    stateReason: 'The predeclared project-bound retest passed under the current policy.', userId });
  assert.equal(passed.deploymentGate, 'proceed_candidate');

  const purge = await prepareRiskKnowledgeRuntimeEvidencePurge({ projectId: project.id, eventIds: [retestEventId], reason: 'test retention expiry' });
  assert.equal(purge.linksRemoved, 1);
  await db.prepare('DELETE FROM runtime_events WHERE id=?').run(retestEventId);
  const readiness = await getProjectEvidenceReadiness({ workspaceId: workspace.id, projectId: project.id });
  const state = readiness.states.find((item) => item.entryId === 'ARL-KB-053');
  assert.equal(state.evidenceState, 'expired');
  assert.equal(state.deploymentGate, 'hold');

  const reprofiled = await applyProjectRiskKnowledgeProfile({
    workspaceId: workspace.id,
    projectId: project.id,
    architectureFacts: { uses_tools: false },
    userId,
  });
  const expiredAfterReprofile = reprofiled.results.find((item) => item.entryId === 'ARL-KB-053');
  assert.equal(expiredAfterReprofile.evidenceState, 'expired');
  assert.equal(expiredAfterReprofile.deploymentGate, 'hold');
});

test('runtime retention removes risk links without silently clearing an open critical finding', async () => {
  const { userId, workspace, project } = await fixture('retention');
  await applyProjectRiskKnowledgeProfile({
    workspaceId: workspace.id,
    projectId: project.id,
    architectureFacts: { uses_tools: true, is_production: true },
    userId,
  });
  const now = new Date();
  const oldCreatedAt = new Date(now.getTime() - (2 * 86400000)).toISOString();
  await db.prepare('UPDATE security_projects SET retention_days=1 WHERE id=?').run(project.id);
  const eventId = await insertRuntimeEvent(project.id, { createdAt: oldCreatedAt });
  await linkRiskKnowledge({
    workspaceId: workspace.id,
    projectId: project.id,
    subjectType: 'runtime_event',
    subjectId: eventId,
    entryId: 'ARL-KB-053',
    linkRole: 'primary',
    userId,
    subjectResolver: resolveRiskKnowledgeSubject,
  });
  await setProjectRiskKnowledgeState({
    workspaceId: workspace.id,
    projectId: project.id,
    entryId: 'ARL-KB-053',
    evidenceState: 'finding_open',
    stateReason: 'A critical runtime finding remains open until remediated and retested.',
    userId,
  });

  const summary = await enforceRetention({ now });
  assert.ok(summary.runtimeEventsPurged >= 1);
  assert.equal((await db.prepare('SELECT COUNT(*) AS count FROM runtime_events WHERE id=?').get(eventId)).count, 0);
  assert.equal((await db.prepare(`SELECT COUNT(*) AS count FROM risk_knowledge_links
    WHERE workspace_id=? AND project_id=? AND subject_type='runtime_event' AND subject_id=?`).get(workspace.id, project.id, eventId)).count, 0);

  const readiness = await getProjectEvidenceReadiness({ workspaceId: workspace.id, projectId: project.id });
  const state = readiness.states.find((item) => item.entryId === 'ARL-KB-053');
  assert.equal(state.evidenceState, 'finding_open');
  assert.equal(state.evidenceCount, 0);
  assert.equal(state.criticalGateFailed, true);
  assert.equal(state.deploymentGate, 'do_not_deploy');
});
