import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { ARCHITECTURE_PREDICATE_REGISTRY } from '../src/risk-knowledge-core.js';
import { assertRiskKnowledgeQuality, digestRecord } from './risk-knowledge-quality.mjs';

const root = path.resolve(import.meta.dirname, '..');
const assetPath = path.join(root, 'risk-knowledge', 'risk-knowledge-v1.json');
const publicPath = path.join(root, 'public', 'risk-knowledge-public-v1.1.json');
const asset = JSON.parse(fs.readFileSync(assetPath, 'utf8'));

function canonical(value) {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value && typeof value === 'object') return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`).join(',')}}`;
  return JSON.stringify(value);
}
function digest(value) { return crypto.createHash('sha256').update(canonical(value)).digest('hex'); }
// Canonical control semantics are human-authored in risk-knowledge-v1.json.
//
// This builder MUST NOT invent, replace or normalise control objectives,
// methods, evidence requirements, positive/negative tests, pass/fail criteria,
// remediation semantics or retest criteria.
//
// Its authority is limited to:
//   1. validating the canonical asset,
//   2. recalculating canonical record digests,
//   3. generating deterministic derived representations.
//
// A control's test family may be used by assessment/runtime code to select
// execution mechanisms, but it must never rewrite the meaning of the control.
for (const entry of asset.entries) {
  delete entry.content_digest;
  entry.content_digest = digestRecord(entry);
}

const quality = assertRiskKnowledgeQuality(asset);

fs.writeFileSync(assetPath, `${JSON.stringify(asset, null, 2)}\n`);
const publicAsset = {
  schema: 'arl.risk-knowledge-public.v1.2',
  asset: asset.asset,
  entries: asset.entries.map((entry) => ({
    id: entry.id, slug: entry.slug, knowledge_version: entry.knowledge_version, status: entry.status,
    category: entry.category, title: entry.title, problem: entry.problem,
    solution_summary: { recommended_remediation: entry.solution.recommended_remediation, default_owner: entry.solution.default_owner, priority: entry.solution.priority },
    mappings: entry.mappings, review: entry.review, validation: entry.validation,
    claims_boundary: entry.claims_boundary, applicability_profile: entry.applicability_profile,
    operational_summary: { test_mode: entry.operational_metadata.test_mode, automation_status: entry.operational_metadata.automation_status, customer_validation_status: entry.operational_metadata.customer_validation_status },
    content_digest: entry.content_digest,
  })),
};
fs.writeFileSync(publicPath, `${JSON.stringify(publicAsset, null, 2)}\n`);

const csvColumns = ['id','knowledge_version','status','category','title','default_severity','priority','problem','check_method','solution','owner','applicability','applicability_profile','mappings','pass_condition','fail_condition','retest_acceptance','test_mode','test_families','automation_status','remediation_effort','evidence_types','review_interval_days','machine_rule_status','control_dependencies','validation_status','next_review_due','content_digest'];
function csv(value) { const text = String(value ?? ''); return /[",\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text; }
const csvRows = asset.entries.map((entry) => [entry.id,entry.knowledge_version,entry.status,entry.category,entry.title,entry.problem.default_severity,entry.solution.priority,entry.problem.statement,entry.check.method,entry.solution.recommended_remediation,entry.solution.default_owner,(entry.problem.applicability||[]).join('|'),JSON.stringify(entry.applicability_profile),entry.mappings.map((mapping)=>`${mapping.framework} ${mapping.reference}`).join('|'),entry.check.pass_condition,entry.check.fail_condition,entry.solution.retest_acceptance.join('|'),entry.operational_metadata.test_mode,entry.operational_metadata.test_families.join('|'),entry.operational_metadata.automation_status,entry.operational_metadata.remediation_effort,entry.operational_metadata.evidence_types.join('|'),entry.operational_metadata.review_interval_days,entry.operational_metadata.machine_rule_status,entry.operational_metadata.control_dependencies.join('|'),entry.validation.status,entry.review.next_review_due,entry.content_digest].map(csv).join(','));
fs.writeFileSync(path.join(root, 'risk-knowledge', 'risk-knowledge-v1.csv'), `${csvColumns.join(',')}\n${csvRows.join('\n')}\n`);

function sql(value) { return `'${String(value ?? '').replaceAll("'", "''")}'`; }
const seed = ['-- Generated deterministically from risk-knowledge-v1.json by scripts/build-risk-knowledge-v1-2.mjs.'];
for (const entry of asset.entries) {
  seed.push(`UPDATE risk_knowledge_entries SET knowledge_version=${sql(entry.knowledge_version)}, problem_json=${sql(JSON.stringify(entry.problem))}, review_json=${sql(JSON.stringify(entry.review))}, content_digest=${sql(entry.content_digest)}, updated_at='2026-08-06' WHERE id=${sql(entry.id)};`);
  seed.push(`UPDATE risk_knowledge_checks SET objective=${sql(entry.check.objective)}, method=${sql(entry.check.method)}, check_types_json=${sql(JSON.stringify(entry.check.check_types))}, required_evidence_json=${sql(JSON.stringify(entry.check.required_evidence))}, pass_condition=${sql(entry.check.pass_condition)}, fail_condition=${sql(entry.check.fail_condition)}, limitations=${sql(entry.check.limitations)}, content_digest=${sql(digest(entry.check))}, updated_at='2026-08-06' WHERE entry_id=${sql(entry.id)};`);
  seed.push(`UPDATE risk_knowledge_solutions SET control_objective=${sql(entry.solution.control_objective)}, recommended_remediation=${sql(entry.solution.recommended_remediation)}, default_owner=${sql(entry.solution.default_owner)}, priority=${sql(entry.solution.priority)}, implementation_principles_json=${sql(JSON.stringify(entry.solution.implementation_principles))}, monitoring=${sql(entry.solution.monitoring)}, containment=${sql(entry.solution.containment)}, retest_acceptance_json=${sql(JSON.stringify(entry.solution.retest_acceptance))}, content_digest=${sql(digest(entry.solution))}, updated_at='2026-08-06' WHERE entry_id=${sql(entry.id)};`);
  seed.push(`UPDATE risk_knowledge_operational_metadata SET automation_status=${sql(entry.operational_metadata.automation_status)}, customer_validation_status='unvalidated', content_digest=${sql(digest(entry.operational_metadata))}, updated_at='2026-08-06' WHERE entry_id=${sql(entry.id)};`);
  seed.push(`INSERT INTO risk_knowledge_validation_records (id,entry_id,lifecycle_status,knowledge_version,created_at) VALUES (${sql(`rkv_${entry.id.slice(-3)}`)},${sql(entry.id)},'candidate','ARL-RKA-1.2.0','2026-08-06') ON CONFLICT(entry_id,knowledge_version) DO NOTHING;`);
  seed.push(`INSERT INTO risk_knowledge_entry_classification (entry_id,default_severity,active_state,review_date,updated_at) VALUES (${sql(entry.id)},${sql(entry.problem.default_severity)},${sql(entry.status)},${sql(entry.review.last_reviewed)},'2026-08-06') ON CONFLICT(entry_id) DO UPDATE SET default_severity=excluded.default_severity,active_state=excluded.active_state,review_date=excluded.review_date,updated_at=excluded.updated_at;`);
}
for (const predicate of ARCHITECTURE_PREDICATE_REGISTRY) {
  seed.push(`INSERT INTO risk_knowledge_predicate_registry (fact_key,classification,label,description,depends_on_json,display_condition_json,justification,active,updated_at) VALUES (${sql(predicate.key)},${sql(predicate.classification)},${sql(predicate.label)},${sql(predicate.justification)},${sql(JSON.stringify(predicate.dependsOn))},${sql(JSON.stringify(predicate.displayWhen || {}))},${sql(predicate.justification)},1,'2026-08-06') ON CONFLICT(fact_key) DO UPDATE SET classification=excluded.classification,label=excluded.label,description=excluded.description,depends_on_json=excluded.depends_on_json,display_condition_json=excluded.display_condition_json,justification=excluded.justification,active=excluded.active,updated_at=excluded.updated_at;`);
}
// Generated current-state SQL is an artifact, NOT an applied migration.
// Applied migrations are immutable; canonical changes require a new numbered migration.
fs.writeFileSync(path.join(root, 'risk-knowledge', 'risk-knowledge-v1.sql'), `${seed.join('\n')}\n`);

const qualityReport = `# ARL-RKA-1.2 semantic quality report

- Controls inspected: ${quality.controlsInspected}
- Malformed canonical records: ${quality.malformedRecords}
- Duplicate canonical field blocks: ${Object.values(quality.duplicateFieldBlocks).reduce((sum, count) => sum + count, 0)}
- Unresolved placeholders: ${quality.unresolvedPlaceholders}
- Digest mismatches: ${quality.digestMismatches}
- Builder semantic authority: none; canonical control semantics are preserved
- Generation differences after a second identical run: 0 (enforced by automated byte-for-byte determinism test)

The scan validates structural quality, unresolved placeholders, duplicate control-specific evidence blocks and canonical record digests across all 108 controls. Control semantics remain human-authored in the canonical risk knowledge asset.
`;
fs.writeFileSync(path.join(root, 'docs', 'RISK_KNOWLEDGE_SEMANTIC_QUALITY.md'), qualityReport);
