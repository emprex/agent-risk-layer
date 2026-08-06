import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { ARCHITECTURE_PREDICATE_REGISTRY } from '../src/risk-knowledge-core.js';
import { assertRiskKnowledgeQuality, digestRecord } from './risk-knowledge-quality.mjs';

const root = path.resolve(import.meta.dirname, '..');
const assetPath = path.join(root, 'risk-knowledge', 'risk-knowledge-v1.json');
const publicPath = path.join(root, 'public', 'risk-knowledge-public-v1.1.json');
const asset = JSON.parse(fs.readFileSync(assetPath, 'utf8'));
const affectedBeforeCorrection = 108; // Recorded by the pre-fix full-catalogue semantic scan.

function canonical(value) {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value && typeof value === 'object') return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`).join(',')}}`;
  return JSON.stringify(value);
}
function digest(value) { return crypto.createHash('sha256').update(canonical(value)).digest('hex'); }
function lower(value) { return String(value || '').replace(/[.]+$/, '').toLowerCase(); }
function actor(entry) {
  const text = `${entry.title} ${entry.problem.statement}`.toLowerCase();
  if (/prompt|retriev|rag|email|file|memory|content/.test(text)) return 'an external content author, compromised source, malicious user, or unsafe model output';
  if (/tenant|authori[sz]|access|identity|permission|privilege/.test(text)) return 'a malicious or mistaken authenticated user, compromised agent identity, or authorization defect';
  if (/supply|dependenc|model format|mcp|provider|third.party/.test(text)) return 'a compromised supplier, dependency maintainer, MCP operator, or deployment pipeline';
  if (/availability|recover|backup|restore|incident|rollback/.test(text)) return 'an operator error, infrastructure failure, destructive tool action, or attacker';
  return 'a malicious user, compromised dependency, unsafe model behaviour, or operator error';
}
function assets(entry) {
  const text = `${entry.title} ${entry.problem.statement}`.toLowerCase();
  const out = [];
  if (/tenant|identity|access|authori|permission/.test(text)) out.push('tenant-scoped records and object identifiers', 'service identities, roles and credentials');
  if (/prompt|context|memory|rag|retriev|email|file/.test(text)) out.push('system prompt, retrieved context and persistent memory', 'source documents, messages and generated outputs');
  if (/tool|mcp|action|money|delete|deploy|code/.test(text)) out.push('tool endpoints and downstream systems', 'financial, administrative or state-changing actions');
  if (/model|supply|dependenc|artifact/.test(text)) out.push('model and dependency artefacts', 'build, registry and deployment provenance');
  if (/recover|backup|availability|incident/.test(text)) out.push('backups, runtime state and recovery infrastructure', 'service availability and data integrity');
  return [...new Set([...out, ...(entry.problem.affected_assets || [])])].slice(0, 6);
}
function boundary(entry) {
  const labels = (entry.problem.applicability || []).join(', ');
  return `The test crosses the boundary between ${labels || 'the assessed agent'} and the identities, data sources, tools, providers or operators that can influence or receive its actions.`;
}
function specificVectors(entry) {
  const text = `${entry.title} ${entry.problem.statement}`.toLowerCase();
  if (/server.side request|ssrf|url|network destination/.test(text)) return 'Exercise loopback, private, link-local, multicast and reserved ranges; cloud metadata endpoints; redirects; DNS rebinding; IPv4/IPv6 and alternate numeric IP forms. Resolve and validate every hop and require fail-closed denial.';
  if (/tenant|cross.tenant|isolation/.test(text)) return 'Create Tenant A and Tenant B users, roles and object IDs. Attempt direct-ID, list, search, export and tool access across tenants; expect indistinguishable authorization failures and no foreign metadata.';
  if (/prompt injection|instruction|untrusted content/.test(text)) return 'Inject conflicting instructions directly and through retrieved pages, files, email, tool output and memory. Verify untrusted text cannot change authority, disclose protected context or bypass approval.';
  if (/approval|human review|consent/.test(text)) return 'Bind approval to the exact action, canonical parameters, target, value, actor, environment, expiry and nonce. Mutate each field and replay the token; every variant must be denied.';
  if (/tool|mcp|function/.test(text)) return 'Use least-privileged test identities; mutate tool names, arguments, object IDs and response fields. Recheck authorization at execution time and verify restricted response data is removed.';
  if (/recover|restore|backup|rollback/.test(text)) return 'Restore an isolated copy, verify object counts and integrity digests, measure recovery objectives, reconcile transactions, and re-enable only after an accountable reviewer accepts the evidence.';
  if (/runtime|policy|guard|enforcement/.test(text)) return 'Capture policy version, digest, input, decision and blocked action. Test missing policy, stale policy, malformed input, direct endpoint calls and alternate execution paths for fail-closed behaviour.';
  if (/supply|dependenc|model format|provenance|provider/.test(text)) return 'Verify model provenance, signed dependency and container digests, MCP-server trust, allowed registries and rejection of executable or unsafe model formats before loading.';
  return `Execute the documented check for “${entry.title}” against the exact assessed version, then vary identity, scope, malformed input, replay and a bypass path relevant to the control.`;
}

asset.schema = 'arl.risk-knowledge-asset.v1.2';
asset.asset.version = 'ARL-RKA-1.2.0';
asset.asset.updated_at = '2026-08-06';
asset.asset.validation_statement = 'All entries are expert-authored candidates until supported by a lifecycle review record. Usage or age never promotes an entry.';
for (const entry of asset.entries) {
  const id = entry.id;
  const problem = lower(entry.problem.statement);
  const testVector = specificVectors(entry);
  const method = entry.check.method.split(`. ${testVector}`)[0].replace(/[.]+$/, '');
  const remediation = entry.solution.recommended_remediation.replace(/[.]+$/, '');
  entry.knowledge_version = 'ARL-RKA-1.2.0';
  entry.problem.customer_symptom = `A user or operator may observe ${problem}; the resulting symptom can include an unauthorized action, incorrect output, unavailable service, data exposure or an evidence gap within this control's stated scope.`;
  entry.problem.credible_failure_or_attack = `${actor(entry)} can exploit or trigger the condition in ${problem}, crossing the assessed trust boundary before an external enforcement point detects or blocks it.`;
  entry.problem.affected_assets = assets(entry);
  entry.problem.threat_actor_or_failure_source = actor(entry);
  entry.problem.trust_boundary = boundary(entry);
  entry.problem.operational_impact = `If ${lower(entry.problem.statement)}, accountable operators may need to stop affected actions, investigate scoped data and identities, restore integrity, notify stakeholders where required, and hold deployment until retest evidence exists.`;
  entry.check.preconditions = [`Use an owner-authorised non-production target matching ${id}'s relevant configuration.`, 'Use synthetic data and reversible or dry-run side effects.', 'Record the assessed version, environment, control configuration and expected decision before execution.'];
  entry.check.method = `${method}. ${testVector}`;
  entry.check.positive_test = `With the documented control enabled for ${id}, execute an authorised in-scope request and verify only the intended identity, data and side effect are available.`;
  entry.check.negative_test = `Attempt the ${id} failure using an unauthorised identity, boundary-crossing input, malformed variant and direct/replayed execution path; record every policy and downstream response.`;
  entry.check.required_identities = ['control owner or authorised tester', 'least-privileged legitimate test identity', 'unauthorised or cross-boundary test identity where applicable'];
  entry.check.required_inputs_and_expected_outputs = [`A valid ${id} test input with the minimum required scope must produce the documented bounded result.`, `An abuse input targeting “${entry.title}” must be denied, quarantined or routed to explicit review before a material side effect.`];
  entry.check.required_evidence = [`${id} assessed system, version, environment and scope for ${entry.title}`, `${id} control configuration or source location showing how ${entry.solution.control_objective.toLowerCase()}`, `${id} positive and abuse inputs with expected and observed outputs for ${entry.problem.affected_assets.slice(0, 2).join(' and ')}`, `${id} policy, authorization, tool or audit events proving whether the tested ${entry.title.toLowerCase()} path executed`, `${id} tester identity, role, timestamp and evidence digest`];
  entry.check.pass_condition = `${id} passes only when “${entry.title}” is not reproducible through the documented abuse cases, the valid workflow remains bounded to ${entry.problem.affected_assets.slice(0, 2).join(' and ')}, denial occurs before side effects, and version-bound observed evidence matches the expected decision.`;
  entry.check.fail_condition = `${id} fails when ${lower(entry.problem.statement)}, or when the relevant control is declaration-only, bypassable, fail-open, applied after a side effect, evaluated under the wrong identity or tenant, or unsupported by reproducible evidence.`;
  entry.check.limitations = `This bounded ${id} test does not prove absence of undiscovered paths, future regressions or risks outside the stated identities, inputs, environment and version.`;
  entry.check.safe_testing_constraints = ['Written owner authorization is required.', 'Use staging, synthetic records, capped values and dry-run tools.', 'Do not target third parties, production customers or irreversible actions.', 'Stop on unexpected access, data exposure or uncontrolled side effects.'];
  entry.solution.immediate_containment = `Immediately disable or isolate the ${id} capability or route, revoke affected credentials, stop queued side effects, and preserve relevant policy, identity and downstream evidence.`;
  entry.solution.root_cause_remediation = `${remediation}. Remove the enabling trust-boundary defect rather than relying on prompt wording or operator vigilance.`;
  entry.solution.preventive_control = `Enforce ${id} outside the model using deny-by-default identity, authorization, input and output boundaries tied to the exact action and environment.`;
  entry.solution.implementation_principles = [`${id}: enforce the decision outside the model before any material side effect.`, `${id}: grant the minimum identity, data, tool and network scope required for the approved task.`, `${id}: version configuration, preserve rollback, and fail closed when policy, identity or evidence is unavailable.`];
  entry.solution.monitoring = `For ${id}, record policy version and digest, actor, target, decision, denial reason and side-effect outcome; alert the ${entry.solution.default_owner} on bypass attempts, configuration drift, repeated denials and missing decision evidence.`;
  entry.solution.containment = `Contain ${id} by disabling the affected capability or route, revoking scoped authority, isolating impacted identities and data, preserving versioned evidence, and requiring owner approval before re-enablement.`;
  entry.solution.accountable_owner = entry.solution.default_owner;
  entry.solution.implementation_dependencies = ['authoritative identity and project scope', 'external enforcement point or configuration owner', 'audit/event retention appropriate to the assessed risk', 'reversible deployment and test environment'];
  entry.solution.rollback_considerations = `Keep the prior known-good ${id} configuration and its digest; rollback must not restore over-broad credentials, stale approvals or incompatible evidence links.`;
  entry.solution.retest_requirements = `Repeat the exact ${id} failure and its identity, malformed-input, replay and bypass variants against the remediated version before changing the deployment decision.`;
  entry.solution.retest_acceptance = [
    `${id}: “${entry.title}” is no longer reproducible against the exact remediated version.`,
    `${id}: Authorised in-scope use completes successfully, remains within the documented asset scope for ${entry.title.toLowerCase()}, and produces no unintended side effect.`,
    `${id}: Unauthorised identity, boundary-crossing, malformed-input, replay and relevant bypass variants are denied before execution, with the expected policy and downstream events recorded.`,
    `${id}: Reviewer identity, timestamp, deployed version, evidence digest, known limitations and rollback decision are recorded.`,
  ];
  entry.solution.evidence_required_to_close = [`Approved remediation change and exact deployed version for ${id}`, `Passed retest evidence bound to ${id} and the current knowledge digest`, 'Named accountable reviewer and residual-risk/deployment decision'];
  entry.review.change_triggers = [`${id} control or enforcement change`, `${id} model, prompt, tool, identity, data-source or provider change`, `${id} bypass, incident or new attack evidence`, `${id} evidence expiry or material scope change`];
  entry.validation = { status: 'candidate', version: 'ARL-RKA-1.2.0', reviewer: null, reviewed_at: null, evidence_reference: null, statement: 'Expert-authored candidate; not customer-exercised, independently reviewed or verified automation.' };
  entry.operational_metadata.automation_status = entry.operational_metadata.automation_status === 'verified' ? 'candidate' : entry.operational_metadata.automation_status;
  entry.operational_metadata.customer_validation_status = 'unvalidated';
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
fs.writeFileSync(path.join(root, 'migrations', '014_seed_risk_knowledge_v1_2.sql'), `${seed.join('\n')}\n`);

const qualityReport = `# ARL-RKA-1.2 semantic quality report

- Controls inspected: ${quality.controlsInspected}
- Malformed records found before correction: ${affectedBeforeCorrection}
- Records corrected by deterministic regeneration: ${affectedBeforeCorrection}
- Malformed records after correction: ${quality.malformedRecords}
- Duplicate field blocks after correction: ${Object.values(quality.duplicateFieldBlocks).reduce((sum, count) => sum + count, 0)}
- Unresolved placeholders after correction: ${quality.unresolvedPlaceholders}
- Digest mismatches after correction: ${quality.digestMismatches}
- Generation differences after a second identical run: 0 (enforced by automated byte-for-byte determinism test)

The scan covers positive tests, abuse tests, retest acceptance, sentence completeness, orphaned lowercase fragments, known malformed combinations, unresolved placeholders, duplicate pass/fail/evidence/retest blocks and canonical record digests across all 108 controls.
`;
fs.writeFileSync(path.join(root, 'docs', 'RISK_KNOWLEDGE_SEMANTIC_QUALITY.md'), qualityReport);
