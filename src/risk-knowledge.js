import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { db, id, nowIso } from './db.js';
import {
  ARCHITECTURE_PREDICATE_REGISTRY,
  buildControlManifest,
  evaluateApplicability,
  getSeveritySemantics,
  resolveArchitectureFacts,
  summarizeEvidenceReadiness,
  toYaml,
  assertRegoExportAllowed,
  validateArchitectureFacts,
} from './risk-knowledge-core.js';

const knowledgeAsset = JSON.parse(fs.readFileSync(path.resolve(process.cwd(), 'risk-knowledge/risk-knowledge-v1.json'), 'utf8'));
const knowledgeRecords = new Map(knowledgeAsset.entries.map((entry) => [entry.id, entry]));

export function riskKnowledgeFilterOptions() {
  const count = (values) => [...values.reduce((map, value) => value ? map.set(value, (map.get(value) || 0) + 1) : map, new Map())]
    .map(([value, resultCount]) => ({ value, count: resultCount })).sort((a, b) => a.value.localeCompare(b.value));
  return {
    category: count(knowledgeAsset.entries.map((entry) => entry.category)),
    severity: [],
    severityStatus: [{ value: 'context_required', count: knowledgeAsset.entries.length }],
    owner: count(knowledgeAsset.entries.map((entry) => entry.solution.default_owner)),
    framework: count(knowledgeAsset.entries.flatMap((entry) => [...new Set(entry.mappings.map((mapping) => mapping.framework))])),
    validationStatus: count(knowledgeAsset.entries.map((entry) => entry.validation?.status || 'candidate')),
    testMode: count(knowledgeAsset.entries.map((entry) => entry.operational_metadata.test_mode)),
    automationStatus: count(knowledgeAsset.entries.map((entry) => entry.operational_metadata.automation_status)),
  };
}

export function architecturePredicateRegistry() { return ARCHITECTURE_PREDICATE_REGISTRY; }

const ALLOWED_SUBJECT_TYPES = new Set([
  'assessment_finding','inspection_finding','redteam_case','runtime_event',
  'approval','remediation','retest','deployment_decision','evidence_artifact',
]);
const ALLOWED_EVIDENCE_STATES = new Set([
  'not_assessed','declared','observed','test_passed','finding_open',
  'remediation_in_progress','retest_passed','risk_accepted','expired',
]);
const ALLOWED_APPLICABILITY = new Set(['unknown','applicable','not_applicable']);
const ALLOWED_LINK_ROLES = new Set(['primary','related','control','retest']);
const EVIDENCE_TRANSITIONS = Object.freeze({
  not_assessed: new Set(['declared','observed','finding_open','expired']),
  declared: new Set(['observed','finding_open','expired']),
  observed: new Set(['test_passed','finding_open','expired']),
  test_passed: new Set(['finding_open','expired']),
  finding_open: new Set(['remediation_in_progress','risk_accepted','expired']),
  remediation_in_progress: new Set(['retest_passed','finding_open','risk_accepted','expired']),
  retest_passed: new Set(['finding_open','expired']),
  risk_accepted: new Set(['finding_open','expired']),
  expired: new Set(['declared','observed','finding_open']),
});
const REQUIRED_LINK_TYPES = Object.freeze({
  observed: new Set(['inspection_finding','evidence_artifact']),
  // A generic implementation artifact is not proof that a test passed. Until
  // project-bound Inspector or Red Team results exist, this transition remains
  // intentionally unavailable.
  test_passed: new Set(['inspection_finding','redteam_case']),
  finding_open: new Set(['assessment_finding','inspection_finding','redteam_case','runtime_event']),
  remediation_in_progress: new Set(['remediation']),
  retest_passed: new Set(['retest']),
  // Runtime action approval is not risk acceptance. Risk acceptance requires a
  // dedicated, project-bound deployment decision record.
  risk_accepted: new Set(['deployment_decision']),
});

function parseJson(value, fallback) { try { return JSON.parse(value); } catch { return fallback; } }
function bounded(value, max = 200) { return String(value ?? '').trim().slice(0, max); }
function boolInt(value) { return value ? 1 : 0; }
function placeholders(length) { return Array.from({ length }, () => '?').join(','); }
function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value && typeof value === 'object') return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(',')}}`;
  return JSON.stringify(value);
}
function integrityError(entryId, reason) {
  console.error(JSON.stringify({ event: 'risk_knowledge.integrity_mismatch', entryId: bounded(entryId, 80), reason, timestamp: nowIso() }));
  return Object.assign(new Error('Versioned risk knowledge content failed integrity verification.'), { statusCode: 503, code: 'RISK_KNOWLEDGE_INTEGRITY_FAILURE' });
}
function verifyAuthoritativeRecord(row) {
  const expected = knowledgeRecords.get(row?.id);
  if (!expected) throw integrityError(row?.id || 'unknown', 'missing_record');
  if (!row.content_digest || !/^[a-f0-9]{64}$/.test(row.content_digest)) throw integrityError(row.id, 'missing_or_invalid_digest');
  const unsigned = { ...expected };
  delete unsigned.content_digest;
  const calculated = crypto.createHash('sha256').update(canonicalJson(unsigned)).digest('hex');
  if (calculated !== expected.content_digest || row.content_digest !== expected.content_digest) throw integrityError(row.id, 'digest_mismatch');
  if (row.knowledge_version !== expected.knowledge_version) throw integrityError(row.id, 'stale_version');
  return expected;
}
function publicEntry(row) {
  if (!row) return null;
  verifyAuthoritativeRecord(row);
  const lifecycleStatus = row.validation_status || 'candidate';
  return {
    id: row.id,
    slug: row.slug,
    knowledgeVersion: row.knowledge_version,
    status: row.status,
    category: row.category,
    title: row.title,
    ...getSeveritySemantics({ scope: 'catalogue' }),
    defaultPriority: null,
    lifecycleStatus,
    problem: parseJson(row.problem_json, {}),
    evidenceChain: parseJson(row.evidence_chain_json, []),
    review: parseJson(row.review_json, {}),
    claimsBoundary: row.claims_boundary,
    contentDigest: row.content_digest,
    operationalMetadata: row.test_mode ? {
      testMode: row.test_mode,
      testFamilies: parseJson(row.test_families_json, []),
      automationStatus: row.automation_status,
      remediationEffort: row.remediation_effort,
      evidenceTypes: parseJson(row.evidence_types_json, []),
      reviewIntervalDays: row.review_interval_days,
      machineRuleStatus: row.machine_rule_status,
      controlDependencies: parseJson(row.control_dependencies_json, []),
      customerValidationStatus: row.customer_validation_status,
    } : null,
  };
}
function fullOperationalMetadata(row) {
  if (!row?.test_mode) return null;
  return {
    ...publicEntry(row).operationalMetadata,
    machineRule: parseJson(row.machine_rule_json, null),
    exportCapabilities: parseJson(row.export_capabilities_json, {}),
  };
}
async function auditRiskKnowledge({ workspaceId = null, projectId = null, actorType = 'user', actorId = null, action, targetType, targetId, metadata = {} }) {
  await db.prepare(`INSERT INTO security_audit_log
    (id,workspace_id,project_id,actor_type,actor_id,action,target_type,target_id,metadata_json,created_at)
    VALUES (?,?,?,?,?,?,?,?,?,?)`).run(id('aud_'), workspaceId, projectId, actorType, actorId, action, targetType, targetId, JSON.stringify(metadata), nowIso());
}
function buildApplicabilityProfiles(rows) {
  const profiles = new Map();
  for (const row of rows) {
    let profile = profiles.get(row.entry_id);
    if (!profile) {
      profile = { clauseMatch: 'any', clauses: [], unknownFactBehavior: row.unknown_behavior || 'include_for_review' };
      profiles.set(row.entry_id, profile);
    }
    let clause = profile.clauses[row.clause_index];
    if (!clause) {
      clause = profile.clauses[row.clause_index] = {
        source_label: row.source_label,
        match: row.clause_match,
        predicates: [],
        derivation_status: row.derivation_status,
      };
    }
    if (row.fact_key) clause.predicates.push({ fact: row.fact_key, operator: row.operator, value: parseJson(row.expected_value_json, null) });
  }
  for (const profile of profiles.values()) profile.clauses = profile.clauses.filter(Boolean);
  return profiles;
}
async function loadApplicabilityProfiles(entryIds) {
  if (!entryIds.length) return new Map();
  const rows = await db.prepare(`SELECT * FROM risk_knowledge_applicability_rules WHERE entry_id IN (${placeholders(entryIds.length)}) ORDER BY entry_id, clause_index, predicate_index`).all(...entryIds);
  return buildApplicabilityProfiles(rows);
}
async function requireProject(workspaceId, projectId) {
  const project = await db.prepare('SELECT id FROM security_projects WHERE id = ? AND workspace_id = ?').get(bounded(projectId, 80), bounded(workspaceId, 80));
  if (!project) throw Object.assign(new Error('Project not found in workspace.'), { statusCode: 404 });
  return project;
}

function requiredEvidencePresent(evidenceState, links) {
  const required = REQUIRED_LINK_TYPES[evidenceState];
  if (!required) return true;
  return links.some((link) => required.has(link.subject_type));
}

function deriveRiskState({ applicabilityStatus, applicabilityReason, evidenceState, severity }) {
  let effectiveApplicabilityStatus = applicabilityStatus;
  let effectiveApplicabilityReason = applicabilityReason;
  if (['finding_open','remediation_in_progress'].includes(evidenceState) && applicabilityStatus !== 'applicable') {
    effectiveApplicabilityStatus = 'applicable';
    effectiveApplicabilityReason = evidenceState === 'finding_open'
      ? 'A linked authoritative finding establishes applicability until the finding is remediated, retested or formally accepted.'
      : 'Active remediation preserves applicability until the remediation workflow reaches an evidence-backed outcome.';
  }

  let deploymentGate = 'review_required';
  if (evidenceState === 'finding_open') deploymentGate = severity === 'critical' ? 'do_not_deploy' : 'hold';
  else if (['remediation_in_progress','expired'].includes(evidenceState)) deploymentGate = 'hold';
  else if (effectiveApplicabilityStatus === 'not_applicable') deploymentGate = 'proceed_candidate';
  else if (['test_passed','retest_passed','risk_accepted'].includes(evidenceState) && effectiveApplicabilityStatus === 'applicable') deploymentGate = 'proceed_candidate';

  return {
    applicabilityStatus: effectiveApplicabilityStatus,
    applicabilityReason: effectiveApplicabilityReason,
    deploymentGate,
    criticalGateFailed: severity === 'critical' && evidenceState === 'finding_open',
  };
}

async function loadProjectSeverity(workspaceId, projectId, entryId) {
  const context = await db.prepare(`SELECT project_severity FROM project_risk_context
    WHERE workspace_id=? AND project_id=? AND entry_id=?`).get(workspaceId, projectId, entryId);
  return context?.project_severity && context.project_severity !== 'unassessed' ? context.project_severity : null;
}

async function reconcileEvidenceStatesAfterLinkRemoval({ workspaceId, projectId, entryIds, reason, timestamp }) {
  for (const entryId of [...new Set(entryIds)]) {
    const state = await db.prepare('SELECT evidence_state FROM project_risk_knowledge_states WHERE workspace_id=? AND project_id=? AND entry_id=?').get(workspaceId, projectId, entryId);
    if (!state) continue;
    const links = await db.prepare('SELECT subject_type,link_role FROM risk_knowledge_links WHERE workspace_id=? AND project_id=? AND entry_id=?').all(workspaceId, projectId, entryId);
    const evidenceCount = links.length;
    if (REQUIRED_LINK_TYPES[state.evidence_state] && !requiredEvidencePresent(state.evidence_state, links)
      && ['observed','test_passed','retest_passed','risk_accepted'].includes(state.evidence_state)) {
      await db.prepare(`UPDATE project_risk_knowledge_states
        SET evidence_state='expired',deployment_gate='hold',critical_gate_failed=0,state_reason=?,evidence_count=?,updated_at=?
        WHERE workspace_id=? AND project_id=? AND entry_id=?`)
        .run(bounded(`Evidence expired or was removed: ${reason}`, 2000), evidenceCount, timestamp, workspaceId, projectId, entryId);
    } else {
      await db.prepare('UPDATE project_risk_knowledge_states SET evidence_count=?,updated_at=? WHERE workspace_id=? AND project_id=? AND entry_id=?')
        .run(evidenceCount, timestamp, workspaceId, projectId, entryId);
    }
  }
}

async function removeRiskKnowledgeLinks({ workspaceId, projectId, subjects, reason, timestamp }) {
  if (!subjects.length) return { linksRemoved: 0, entriesAffected: 0 };
  const affectedEntries = [];
  let linksRemoved = 0;
  for (const subject of subjects) {
    const rows = await db.prepare(`SELECT entry_id FROM risk_knowledge_links
      WHERE workspace_id=? AND project_id=? AND subject_type=? AND subject_id=?`)
      .all(workspaceId, projectId, subject.type, subject.id);
    affectedEntries.push(...rows.map((row) => row.entry_id));
    const result = await db.prepare(`DELETE FROM risk_knowledge_links
      WHERE workspace_id=? AND project_id=? AND subject_type=? AND subject_id=?`)
      .run(workspaceId, projectId, subject.type, subject.id);
    linksRemoved += Number(result.changes || 0);
  }
  await reconcileEvidenceStatesAfterLinkRemoval({ workspaceId, projectId, entryIds: affectedEntries, reason, timestamp });
  return { linksRemoved, entriesAffected: new Set(affectedEntries).size };
}

export async function listRiskKnowledge({ query = '', category = '', severity = '', severityStatus = '', framework = '', owner = '', validationStatus = '', testMode = '', automationStatus = '', sort = 'id', limit = 24, offset = 0 } = {}) {
  const safeLimit = Math.max(1, Math.min(Number(limit) || 100, 250));
  const safeOffset = Math.max(0, Number(offset) || 0);
  const clauses = ["e.status = 'active'"];
  const values = [];
  if (category) { clauses.push('e.category = ?'); values.push(bounded(category, 120)); }
  if (query) {
    clauses.push(`(LOWER(e.id) LIKE ? OR LOWER(e.title) LIKE ? OR LOWER(e.category) LIKE ? OR LOWER(e.problem_json) LIKE ?
      OR EXISTS (SELECT 1 FROM risk_knowledge_solutions sq WHERE sq.entry_id=e.id AND LOWER(sq.recommended_remediation) LIKE ?)
      OR EXISTS (SELECT 1 FROM risk_knowledge_mappings mq WHERE mq.entry_id=e.id AND (LOWER(mq.framework) LIKE ? OR LOWER(mq.framework_reference) LIKE ?)))`);
    const term = `%${bounded(query, 160).toLowerCase()}%`;
    values.push(term, term, term, term, term, term, term);
  }
  if (severity) clauses.push('1 = 0');
  if (severityStatus && bounded(severityStatus, 40) !== 'context_required') clauses.push('1 = 0');
  if (testMode) { clauses.push('o.test_mode = ?'); values.push(bounded(testMode, 20)); }
  if (automationStatus) { clauses.push('o.automation_status = ?'); values.push(bounded(automationStatus, 20)); }
  if (validationStatus) { clauses.push('v.lifecycle_status = ?'); values.push(bounded(validationStatus, 40)); }
  if (owner) {
    clauses.push('EXISTS (SELECT 1 FROM risk_knowledge_solutions s WHERE s.entry_id = e.id AND s.default_owner = ?)');
    values.push(bounded(owner, 120));
  }
  if (framework) {
    clauses.push('EXISTS (SELECT 1 FROM risk_knowledge_mappings m WHERE m.entry_id = e.id AND m.framework = ?)');
    values.push(bounded(framework, 160));
  }
  const where = clauses.join(' AND ');
  const totalRow = await db.prepare(`SELECT COUNT(DISTINCT e.id) AS total FROM risk_knowledge_entries e
    LEFT JOIN risk_knowledge_operational_metadata o ON o.entry_id=e.id
    LEFT JOIN risk_knowledge_entry_classification c ON c.entry_id=e.id
    LEFT JOIN risk_knowledge_validation_records v ON v.entry_id=e.id AND v.knowledge_version=e.knowledge_version
    WHERE ${where}`).get(...values);
  const sortSql = sort === 'severity' ? 'e.id'
    : sort === 'reviewDate' ? `c.review_date DESC, e.id`
      : sort === 'relevance' && query ? 'e.title, e.id' : 'e.id';
  const rows = await db.prepare(`
    SELECT e.*, o.test_mode, o.test_families_json, o.automation_status, o.remediation_effort,
      o.evidence_types_json, o.review_interval_days, o.machine_rule_status, o.machine_rule_json,
      o.control_dependencies_json, o.customer_validation_status, o.export_capabilities_json,
      v.lifecycle_status AS validation_status, v.reviewer_name, v.reviewer_organisation, v.reviewed_at AS validation_reviewed_at, v.evidence_reference AS validation_evidence_reference
    FROM risk_knowledge_entries e
    LEFT JOIN risk_knowledge_operational_metadata o ON o.entry_id = e.id
    LEFT JOIN risk_knowledge_entry_classification c ON c.entry_id=e.id
    LEFT JOIN risk_knowledge_validation_records v ON v.entry_id=e.id AND v.knowledge_version=e.knowledge_version
    WHERE ${where}
    ORDER BY ${sortSql} LIMIT ? OFFSET ?
  `).all(...values, safeLimit, safeOffset);
  const total = Number(totalRow?.total || 0);
  if (!rows.length) return { items: [], total, limit: safeLimit, offset: safeOffset, hasMore: false };
  const entryIds = rows.map((row) => row.id);
  const solutionRows = await db.prepare(`SELECT entry_id, default_owner, priority FROM risk_knowledge_solutions WHERE entry_id IN (${placeholders(entryIds.length)}) ORDER BY entry_id, priority, id`).all(...entryIds);
  const mappingRows = await db.prepare(`SELECT entry_id, framework, framework_version, framework_reference, mapping_status, mapping_limit FROM risk_knowledge_mappings WHERE entry_id IN (${placeholders(entryIds.length)}) ORDER BY entry_id, framework, framework_reference`).all(...entryIds);
  const solutions = new Map();
  for (const row of solutionRows) if (!solutions.has(row.entry_id)) solutions.set(row.entry_id, { defaultOwner: row.default_owner, priority: row.priority });
  const mappings = new Map();
  for (const row of mappingRows) {
    if (!mappings.has(row.entry_id)) mappings.set(row.entry_id, []);
    mappings.get(row.entry_id).push({ framework: row.framework, version: row.framework_version, reference: row.framework_reference, mappingStatus: row.mapping_status, mappingLimit: row.mapping_limit });
  }
  const items = rows.map((row) => {
    const solutionSummary = solutions.get(row.id) || null;
    return { ...publicEntry(row), defaultPriority: solutionSummary?.priority || null, validation: { status: row.validation_status || 'candidate', reviewer: row.reviewer_name || null, reviewerOrganisation: row.reviewer_organisation || null, reviewedAt: row.validation_reviewed_at || null, evidenceReference: row.validation_evidence_reference || null }, solutionSummary, mappings: mappings.get(row.id) || [] };
  });
  return { items, total, limit: safeLimit, offset: safeOffset, hasMore: safeOffset + items.length < total };
}

export async function getRiskKnowledgeEntry(identifier) {
  const key = bounded(identifier, 160);
  const row = await db.prepare(`
    SELECT e.*, o.test_mode, o.test_families_json, o.automation_status, o.remediation_effort,
      o.evidence_types_json, o.review_interval_days, o.machine_rule_status, o.machine_rule_json,
      o.control_dependencies_json, o.customer_validation_status, o.export_capabilities_json
    FROM risk_knowledge_entries e
    LEFT JOIN risk_knowledge_operational_metadata o ON o.entry_id = e.id
    WHERE (e.id = ? OR e.slug = ?) AND e.status = 'active' LIMIT 1
  `).get(key, key);
  if (!row) return null;
  const sourceRecord = verifyAuthoritativeRecord(row);
  const entry = publicEntry(row);
  entry.operationalMetadata = fullOperationalMetadata(row);
  const [profiles, checks, solutions, mappings, validation] = await Promise.all([
    loadApplicabilityProfiles([row.id]),
    db.prepare('SELECT * FROM risk_knowledge_checks WHERE entry_id = ? ORDER BY id').all(row.id),
    db.prepare('SELECT * FROM risk_knowledge_solutions WHERE entry_id = ? ORDER BY priority, id').all(row.id),
    db.prepare(`SELECT m.*, r.title AS reference_title, r.url AS reference_url FROM risk_knowledge_mappings m LEFT JOIN risk_knowledge_references r ON r.id = m.reference_id WHERE m.entry_id = ? ORDER BY m.framework, m.framework_reference`).all(row.id),
    db.prepare('SELECT * FROM risk_knowledge_validation_records WHERE entry_id=? AND knowledge_version=?').get(row.id, row.knowledge_version),
  ]);
  entry.validation = validation ? { status: validation.lifecycle_status, reviewer: validation.reviewer_name, reviewerOrganisation: validation.reviewer_organisation, reviewedAt: validation.reviewed_at, evidenceReference: validation.evidence_reference, version: validation.knowledge_version } : { status: 'candidate', version: row.knowledge_version };
  entry.lifecycleStatus = entry.validation.status;
  entry.applicabilityProfile = profiles.get(row.id) || { clauseMatch: 'any', clauses: [], unknownFactBehavior: 'include_for_review' };
  entry.checks = checks.map((check) => ({
    id: check.id,
    objective: check.objective,
    method: check.method,
    checkTypes: parseJson(check.check_types_json, []),
    requiredEvidence: parseJson(check.required_evidence_json, []),
    passCondition: check.pass_condition,
    failCondition: check.fail_condition,
    limitations: check.limitations,
    contentDigest: check.content_digest,
    preconditions: sourceRecord.check.preconditions,
    positiveTest: sourceRecord.check.positive_test,
    negativeTest: sourceRecord.check.negative_test,
    requiredIdentities: sourceRecord.check.required_identities,
    requiredInputsAndExpectedOutputs: sourceRecord.check.required_inputs_and_expected_outputs,
    safeTestingConstraints: sourceRecord.check.safe_testing_constraints,
  }));
  entry.solutions = solutions.map((solution) => ({
    id: solution.id,
    controlObjective: solution.control_objective,
    recommendedRemediation: solution.recommended_remediation,
    defaultOwner: solution.default_owner,
    priority: solution.priority,
    implementationPrinciples: parseJson(solution.implementation_principles_json, []),
    monitoring: solution.monitoring,
    containment: solution.containment,
    retestAcceptance: parseJson(solution.retest_acceptance_json, []),
    contentDigest: solution.content_digest,
    immediateContainment: sourceRecord.solution.immediate_containment,
    rootCauseRemediation: sourceRecord.solution.root_cause_remediation,
    preventiveControl: sourceRecord.solution.preventive_control,
    implementationDependencies: sourceRecord.solution.implementation_dependencies,
    rollbackConsiderations: sourceRecord.solution.rollback_considerations,
    retestRequirements: sourceRecord.solution.retest_requirements,
    evidenceRequiredToClose: sourceRecord.solution.evidence_required_to_close,
  }));
  entry.defaultPriority = entry.solutions[0]?.priority || null;
  entry.mappings = mappings.map((mapping) => ({
    id: mapping.id,
    framework: mapping.framework,
    version: mapping.framework_version,
    reference: mapping.framework_reference,
    mappingStatus: mapping.mapping_status,
    mappingLimit: mapping.mapping_limit,
    sourceTitle: mapping.reference_title,
    sourceUrl: mapping.reference_url,
  }));
  return entry;
}

export async function getPublicRiskKnowledgeEntry(identifier) {
  const entry = await getRiskKnowledgeEntry(identifier);
  if (!entry) return null;
  const solution = entry.solutions?.[0] || null;
  return {
    id: entry.id,
    slug: entry.slug,
    knowledgeVersion: entry.knowledgeVersion,
    status: entry.status,
    category: entry.category,
    title: entry.title,
    severity: entry.severity,
    severityStatus: entry.severityStatus,
    severityModel: entry.severityModel,
    severityScope: entry.severityScope,
    defaultPriority: entry.defaultPriority,
    lifecycleStatus: entry.lifecycleStatus,
    problem: entry.problem,
    claimsBoundary: entry.claimsBoundary,
    contentDigest: entry.contentDigest,
    solutionSummary: solution ? {
      recommendedRemediation: solution.recommendedRemediation,
      defaultOwner: solution.defaultOwner,
      priority: solution.priority,
    } : null,
    operationalMetadata: entry.operationalMetadata ? {
      testMode: entry.operationalMetadata.testMode,
      testFamilies: entry.operationalMetadata.testFamilies,
      automationStatus: entry.operationalMetadata.automationStatus,
      customerValidationStatus: entry.operationalMetadata.customerValidationStatus,
    } : null,
    mappings: entry.mappings,
  };
}

export async function profileRiskKnowledge(facts = {}) {
  const resolvedFacts = resolveArchitectureFacts(facts);
  const { items: entries } = await listRiskKnowledge({ limit: 250 });
  const profiles = await loadApplicabilityProfiles(entries.map((entry) => entry.id));
  const order = { applicable: 0, unknown: 1, not_applicable: 2 };
  return entries.map((entry) => ({
    entry,
    applicability: evaluateApplicability({ applicabilityProfile: profiles.get(entry.id) }, resolvedFacts),
  })).sort((left, right) => order[left.applicability.status] - order[right.applicability.status]);
}

export async function linkRiskKnowledge({ workspaceId, projectId, subjectType, subjectId, entryId, linkRole = 'primary', userId, subjectResolver }) {
  if (!ALLOWED_SUBJECT_TYPES.has(subjectType)) throw Object.assign(new Error('Unsupported risk knowledge subject type.'), { statusCode: 400 });
  if (!ALLOWED_LINK_ROLES.has(linkRole)) throw Object.assign(new Error('Unsupported risk knowledge link role.'), { statusCode: 400 });
  if (typeof subjectResolver !== 'function') throw Object.assign(new Error('Risk knowledge subject ownership resolver is required.'), { statusCode: 500 });
  await requireProject(workspaceId, projectId);
  const resolved = await subjectResolver({ workspaceId, projectId, subjectType, subjectId });
  if (!resolved || resolved.authorized !== true || resolved.workspaceId !== workspaceId || resolved.projectId !== projectId || resolved.subjectType !== subjectType || String(resolved.subjectId) !== String(subjectId)) {
    throw Object.assign(new Error('Referenced evidence subject was not found in this project.'), { statusCode: 404 });
  }
  const entry = await db.prepare("SELECT id, knowledge_version, content_digest FROM risk_knowledge_entries WHERE id = ? AND status = 'active'").get(bounded(entryId, 80));
  if (!entry) throw Object.assign(new Error('Active risk knowledge entry not found.'), { statusCode: 404 });
  verifyAuthoritativeRecord(entry);
  const linkId = id('rkl');
  const createdAt = nowIso();
  const result = await db.prepare(`
    INSERT INTO risk_knowledge_links (id,workspace_id,project_id,subject_type,subject_id,entry_id,link_role,knowledge_version,entry_digest,created_by,created_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(project_id,subject_type,subject_id,entry_id,link_role) DO NOTHING
  `).run(linkId, workspaceId, projectId, subjectType, bounded(subjectId, 160), entry.id, linkRole, entry.knowledge_version, entry.content_digest, userId || null, createdAt);
  if (result.changes) await auditRiskKnowledge({ workspaceId, projectId, actorId: userId, action: 'risk_knowledge.linked', targetType: subjectType, targetId: bounded(subjectId, 160), metadata: { entryId: entry.id, linkRole, knowledgeVersion: entry.knowledge_version, entryDigest: entry.content_digest } });
  return { id: result.changes ? linkId : null, duplicate: result.changes === 0, entryId: entry.id, knowledgeVersion: entry.knowledge_version, entryDigest: entry.content_digest };
}

export async function setProjectRiskKnowledgeState({ workspaceId, projectId, entryId, architectureFacts = null, manualApplicability = null, evidenceState = 'not_assessed', stateReason = '', userId }) {
  if (!ALLOWED_EVIDENCE_STATES.has(evidenceState)) throw Object.assign(new Error('Invalid evidence state.'), { statusCode: 400 });
  await requireProject(workspaceId, projectId);
  const entry = await getRiskKnowledgeEntry(entryId);
  if (!entry) throw Object.assign(new Error('Active risk knowledge entry not found.'), { statusCode: 404 });

  const previous = await db.prepare('SELECT * FROM project_risk_knowledge_states WHERE project_id = ? AND entry_id = ?').get(projectId, entryId);
  let applicabilityStatus = previous?.applicability_status || 'unknown';
  let applicabilityReason = previous?.applicability_reason || 'Architecture facts have not been assessed.';
  let factsDigest = previous?.architecture_facts_digest || null;
  if (architectureFacts !== null) {
    const resolvedFacts = resolveArchitectureFacts(architectureFacts);
    const applicability = evaluateApplicability(entry, resolvedFacts);
    applicabilityStatus = applicability.status;
    applicabilityReason = applicability.reason;
    factsDigest = crypto.createHash('sha256').update(canonicalJson(architectureFacts)).digest('hex');
  } else if (manualApplicability) {
    if (!userId || !ALLOWED_APPLICABILITY.has(manualApplicability.status) || bounded(manualApplicability.reason, 1000).length < 12) {
      throw Object.assign(new Error('Manual applicability requires an authorised reviewer and a meaningful reason.'), { statusCode: 400 });
    }
    applicabilityStatus = manualApplicability.status;
    applicabilityReason = bounded(manualApplicability.reason, 1000);
  }

  if (previous && previous.evidence_state !== evidenceState && !EVIDENCE_TRANSITIONS[previous.evidence_state]?.has(evidenceState)) {
    throw Object.assign(new Error(`Invalid evidence-state transition from ${previous.evidence_state} to ${evidenceState}.`), { statusCode: 409 });
  }

  const links = await db.prepare('SELECT subject_type FROM risk_knowledge_links WHERE workspace_id = ? AND project_id = ? AND entry_id = ?').all(workspaceId, projectId, entryId);
  const required = REQUIRED_LINK_TYPES[evidenceState];
  if (required && !requiredEvidencePresent(evidenceState, links)) {
    throw Object.assign(new Error(`Evidence state ${evidenceState} requires a linked authoritative record.`), { statusCode: 409 });
  }

  const severity = await loadProjectSeverity(workspaceId, projectId, entryId);
  const derived = deriveRiskState({ applicabilityStatus, applicabilityReason, evidenceState, severity });
  applicabilityStatus = derived.applicabilityStatus;
  applicabilityReason = derived.applicabilityReason;
  const { deploymentGate, criticalGateFailed } = derived;
  const createdAt = nowIso();
  const stateId = id('rks');
  await db.prepare(`
    INSERT INTO project_risk_knowledge_states (id,workspace_id,project_id,entry_id,applicability_status,applicability_reason,architecture_facts_digest,evidence_state,deployment_gate,critical_gate_failed,state_reason,evidence_count,last_assessed_at,assessed_by,updated_at,created_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
    ON CONFLICT(project_id,entry_id) DO UPDATE SET applicability_status=excluded.applicability_status,applicability_reason=excluded.applicability_reason,architecture_facts_digest=excluded.architecture_facts_digest,evidence_state=excluded.evidence_state,deployment_gate=excluded.deployment_gate,critical_gate_failed=excluded.critical_gate_failed,state_reason=excluded.state_reason,evidence_count=excluded.evidence_count,last_assessed_at=excluded.last_assessed_at,assessed_by=excluded.assessed_by,updated_at=excluded.updated_at
  `).run(stateId, workspaceId, projectId, entryId, applicabilityStatus, applicabilityReason, factsDigest, evidenceState, deploymentGate, boolInt(criticalGateFailed), bounded(stateReason, 2000), links.length, createdAt, userId || null, createdAt, createdAt);
  await auditRiskKnowledge({ workspaceId, projectId, actorId: userId, action: 'risk_knowledge.state_updated', targetType: 'risk_knowledge_entry', targetId: entryId, metadata: { applicabilityStatus, evidenceState, deploymentGate, criticalGateFailed, evidenceCount: links.length, stateReason: bounded(stateReason, 500) } });
  return { entryId, ...getSeveritySemantics({ scope: 'project', applicability: applicabilityStatus, evaluatedSeverity: severity }), applicabilityStatus, applicabilityReason, evidenceState, deploymentGate, criticalGateFailed, architectureFactsDigest: factsDigest, evidenceCount: links.length };
}

export async function applyProjectRiskKnowledgeProfile({ workspaceId, projectId, architectureFacts, userId }) {
  const resolvedFacts = resolveArchitectureFacts(architectureFacts);
  await requireProject(workspaceId, projectId);
  const { items: entries } = await listRiskKnowledge({ limit: 250 });
  const profiles = await loadApplicabilityProfiles(entries.map((entry) => entry.id));
  const factsDigest = crypto.createHash('sha256').update(canonicalJson(architectureFacts)).digest('hex');
  const timestamp = nowIso();
  const results = [];
  const severityRows = await db.prepare('SELECT entry_id,project_severity FROM project_risk_context WHERE workspace_id=? AND project_id=?').all(workspaceId, projectId);
  const projectSeverities = new Map(severityRows.map((row) => [row.entry_id, row.project_severity === 'unassessed' ? null : row.project_severity]));
  await db.transaction(async () => {
    for (const entry of entries) {
      const applicability = evaluateApplicability({ applicabilityProfile: profiles.get(entry.id) }, resolvedFacts);
      const current = await db.prepare('SELECT evidence_state,state_reason,evidence_count,created_at FROM project_risk_knowledge_states WHERE project_id=? AND entry_id=?').get(projectId, entry.id);
      const evidenceState = current?.evidence_state || 'not_assessed';
      const severity = projectSeverities.get(entry.id) || null;
      const derived = deriveRiskState({
        applicabilityStatus: applicability.status,
        applicabilityReason: applicability.reason,
        evidenceState,
        severity,
      });
      const { applicabilityStatus, applicabilityReason, deploymentGate, criticalGateFailed } = derived;
      const stateId = id('rks');
      await db.prepare(`INSERT INTO project_risk_knowledge_states
        (id,workspace_id,project_id,entry_id,applicability_status,applicability_reason,architecture_facts_digest,evidence_state,deployment_gate,critical_gate_failed,state_reason,evidence_count,last_assessed_at,assessed_by,updated_at,created_at)
        VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
        ON CONFLICT(project_id,entry_id) DO UPDATE SET applicability_status=excluded.applicability_status,applicability_reason=excluded.applicability_reason,architecture_facts_digest=excluded.architecture_facts_digest,deployment_gate=excluded.deployment_gate,critical_gate_failed=excluded.critical_gate_failed,last_assessed_at=excluded.last_assessed_at,assessed_by=excluded.assessed_by,updated_at=excluded.updated_at`)
        .run(stateId, workspaceId, projectId, entry.id, applicabilityStatus, applicabilityReason, factsDigest, evidenceState, deploymentGate, boolInt(criticalGateFailed), current?.state_reason || '', Number(current?.evidence_count || 0), timestamp, userId || null, timestamp, current?.created_at || timestamp);
      results.push({ entryId: entry.id, ...getSeveritySemantics({ scope: 'project', applicability: applicabilityStatus, evaluatedSeverity: severity }), applicabilityStatus, applicabilityReason, evidenceState, deploymentGate, criticalGateFailed });
    }
  });
  await auditRiskKnowledge({ workspaceId, projectId, actorId: userId, action: 'risk_knowledge.profile_applied', targetType: 'project', targetId: projectId, metadata: { factsDigest, entries: results.length, applicable: results.filter((item) => item.applicabilityStatus === 'applicable').length, unknown: results.filter((item) => item.applicabilityStatus === 'unknown').length } });
  return { architectureFactsDigest: factsDigest, results, summary: summarizeEvidenceReadiness(results) };
}

export async function getProjectEvidenceReadiness({ workspaceId, projectId }) {
  await requireProject(workspaceId, projectId);
  const rows = await db.prepare(`
    SELECT s.*, e.title, e.category, e.knowledge_version, e.content_digest,
      c.project_severity, c.rationale AS severity_rationale, c.assessed_by AS severity_assessed_by,
      c.assessed_at AS severity_assessed_at, c.updated_at AS severity_updated_at,
      (SELECT COUNT(*) FROM risk_knowledge_links l WHERE l.workspace_id=s.workspace_id AND l.project_id=s.project_id AND l.entry_id=s.entry_id) live_evidence_count,
      (SELECT COUNT(*) FROM risk_knowledge_links l WHERE l.workspace_id=s.workspace_id AND l.project_id=s.project_id AND l.entry_id=s.entry_id AND (l.knowledge_version<>e.knowledge_version OR l.entry_digest<>e.content_digest)) invalid_evidence_links
    FROM project_risk_knowledge_states s
    JOIN risk_knowledge_entries e ON e.id = s.entry_id
    LEFT JOIN project_risk_context c ON c.workspace_id=s.workspace_id AND c.project_id=s.project_id AND c.entry_id=s.entry_id
    WHERE s.project_id = ? AND s.workspace_id = ? ORDER BY e.category, e.title
  `).all(projectId, workspaceId);
  for (const row of rows) {
    verifyAuthoritativeRecord({ id: row.entry_id, knowledge_version: row.knowledge_version, content_digest: row.content_digest });
    if (Number(row.invalid_evidence_links || 0) > 0) throw integrityError(row.entry_id, 'evidence_link_version_or_digest_mismatch');
  }
  const states = rows.map((row) => {
    const severity = getSeveritySemantics({
      scope: 'project',
      applicability: row.applicability_status,
      evaluatedSeverity: row.project_severity === 'unassessed' ? null : row.project_severity,
    });
    return {
      entryId: row.entry_id,
      title: row.title,
      category: row.category,
      ...severity,
      severityContext: row.project_severity ? {
        workspaceId: row.workspace_id,
        projectId: row.project_id,
        controlProfileVersion: row.knowledge_version,
        rationale: row.severity_rationale || null,
        evaluatorId: row.severity_assessed_by || null,
        evaluatedAt: row.severity_assessed_at || null,
        updatedAt: row.severity_updated_at || null,
        decisionMethod: 'project_risk_context',
      } : null,
      applicabilityStatus: row.applicability_status,
      evidenceState: row.evidence_state,
      deploymentGate: row.deployment_gate,
      criticalGateFailed: Boolean(row.critical_gate_failed),
      stateReason: row.state_reason,
      evidenceCount: Number(row.live_evidence_count || 0),
      lastAssessedAt: row.last_assessed_at,
    };
  });
  return { states, summary: summarizeEvidenceReadiness(states) };
}

export async function prepareRiskKnowledgeSubjectPurge({ projectId, subjects = [], reason = 'linked evidence removed', timestamp = nowIso() }) {
  const safeProjectId = bounded(projectId, 80);
  const safeSubjects = subjects.map((subject) => ({ type: bounded(subject?.type, 40), id: bounded(subject?.id, 160) }))
    .filter((subject) => ALLOWED_SUBJECT_TYPES.has(subject.type) && subject.id);
  if (!safeProjectId || !safeSubjects.length) return { linksRemoved: 0, entriesAffected: 0 };
  const project = await db.prepare('SELECT id,workspace_id FROM security_projects WHERE id=?').get(safeProjectId);
  if (!project) return { linksRemoved: 0, entriesAffected: 0 };
  return db.transaction(async () => {
    const removed = await removeRiskKnowledgeLinks({ workspaceId: project.workspace_id, projectId: safeProjectId, subjects: safeSubjects, reason, timestamp });
    if (removed.linksRemoved) {
      await auditRiskKnowledge({ workspaceId: project.workspace_id, projectId: safeProjectId, actorType: 'system', action: 'risk_knowledge.subject_links_purged', targetType: 'project', targetId: safeProjectId, metadata: { reason, subjectCount: safeSubjects.length, ...removed } });
    }
    return removed;
  });
}

export async function prepareRiskKnowledgeRuntimeEvidencePurge({ projectId, eventIds = [], reason = 'runtime evidence retention expired', timestamp = nowIso() }) {
  const safeProjectId = bounded(projectId, 80);
  const safeEventIds = [...new Set(eventIds.map((value) => bounded(value, 160)).filter(Boolean))];
  if (!safeProjectId || !safeEventIds.length) return { linksRemoved: 0, entriesAffected: 0, artifactsInvalidated: 0 };
  const project = await db.prepare('SELECT id,workspace_id FROM security_projects WHERE id=?').get(safeProjectId);
  if (!project) return { linksRemoved: 0, entriesAffected: 0, artifactsInvalidated: 0 };
  const inList = placeholders(safeEventIds.length);
  return db.transaction(async () => {
    const retests = await db.prepare(`SELECT id FROM remediation_retest_criteria WHERE project_id=? AND runtime_event_id IN (${inList})`).all(safeProjectId, ...safeEventIds);
    const artifacts = await db.prepare(`SELECT id FROM remediation_evidence_artifacts WHERE project_id=? AND source_type='runtime_event' AND source_id IN (${inList})`).all(safeProjectId, ...safeEventIds);
    const subjects = [
      ...safeEventIds.map((subjectId) => ({ type: 'runtime_event', id: subjectId })),
      ...retests.map((row) => ({ type: 'retest', id: row.id })),
      ...artifacts.map((row) => ({ type: 'evidence_artifact', id: row.id })),
    ];
    let artifactsInvalidated = 0;
    if (artifacts.length) {
      const ids = artifacts.map((row) => row.id);
      const result = await db.prepare(`UPDATE remediation_evidence_artifacts
        SET lifecycle_state='invalidated',invalidated_at=? WHERE id IN (${placeholders(ids.length)}) AND lifecycle_state='active'`)
        .run(timestamp, ...ids);
      artifactsInvalidated = Number(result.changes || 0);
    }
    const removed = await removeRiskKnowledgeLinks({ workspaceId: project.workspace_id, projectId: safeProjectId, subjects, reason, timestamp });
    if (removed.linksRemoved || artifactsInvalidated) {
      await auditRiskKnowledge({ workspaceId: project.workspace_id, projectId: safeProjectId, actorType: 'system', action: 'risk_knowledge.evidence_retention_applied', targetType: 'runtime_evidence', targetId: safeProjectId, metadata: { reason, eventCount: safeEventIds.length, ...removed, artifactsInvalidated } });
    }
    return { ...removed, artifactsInvalidated };
  });
}

export async function exportRiskKnowledgeEntry(identifier, format = 'json') {
  const entry = await getRiskKnowledgeEntry(identifier);
  if (!entry) throw Object.assign(new Error('Risk knowledge entry not found.'), { statusCode: 404 });
  const manifest = buildControlManifest(entry);
  if (format === 'json') return { contentType: 'application/json', extension: 'json', body: JSON.stringify(manifest, null, 2) };
  if (format === 'yaml' || format === 'yml') return { contentType: 'application/yaml', extension: 'yaml', body: `${toYaml(manifest)}\n` };
  if (format === 'rego') {
    assertRegoExportAllowed(entry);
    return { contentType: 'text/plain', extension: 'rego', body: entry.operationalMetadata.machineRule.source };
  }
  throw Object.assign(new Error('Unsupported export format.'), { statusCode: 400 });
}

export function verifyRiskKnowledgeDigest(entry) {
  return crypto.createHash('sha256').update(canonicalJson(entry)).digest('hex');
}
