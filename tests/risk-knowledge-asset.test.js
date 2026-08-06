import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {
  evaluateApplicability,
  summarizeEvidenceReadiness,
  buildControlManifest,
  toYaml,
  assertRegoExportAllowed,
  validateArchitectureFacts,
  ARCHITECTURE_FACT_KEYS,
  ARCHITECTURE_PREDICATE_REGISTRY,
} from '../src/risk-knowledge-core.js';

const repositoryRoot = path.resolve(import.meta.dirname, '..');
const asset = JSON.parse(fs.readFileSync(path.join(repositoryRoot, 'risk-knowledge', 'risk-knowledge-v1.json'), 'utf8'));

function read(name) {
  const candidates = [
    path.join(repositoryRoot, name),
    path.join(repositoryRoot, 'public', name),
    path.join(repositoryRoot, 'migrations', name),
    path.join(repositoryRoot, 'src', name),
    path.join(repositoryRoot, 'risk-knowledge', name),
    path.join(repositoryRoot, 'docs', name),
  ];
  const found = candidates.find((candidate) => fs.existsSync(candidate));
  if (!found) throw new Error(`Fixture not found: ${name}`);
  return fs.readFileSync(found, 'utf8');
}

test('v1.2 asset has complete unique candidate records and corrected metrics', () => {
  assert.equal(asset.schema, 'arl.risk-knowledge-asset.v1.2');
  assert.equal(asset.asset.version, 'ARL-RKA-1.2.0');
  assert.equal(asset.entries.length, 108);
  assert.equal(new Set(asset.entries.map((entry) => entry.id)).size, 108);
  assert.equal(asset.asset.verified_metrics.framework_mapping_records['OWASP Agentic Top 10 2026'], 57);
  assert.equal(asset.asset.verified_metrics.framework_mapped_entry_counts['OWASP Agentic Top 10 2026'], 56);
  assert.match(asset.asset.verified_metrics.metric_note, /82 mapped controls is not supported/i);
  for (const entry of asset.entries) {
    assert.match(entry.content_digest, /^[a-f0-9]{64}$/);
    assert.equal(entry.knowledge_version, 'ARL-RKA-1.2.0');
    assert.equal(entry.validation.status, 'candidate');
    assert.ok(entry.applicability_profile.clauses.length >= 1);
    assert.equal(entry.applicability_profile.unknown_fact_behavior, 'include_for_review');
    assert.ok(['automated','hybrid','manual'].includes(entry.operational_metadata.test_mode));
    assert.ok(['verified','candidate','unsupported'].includes(entry.operational_metadata.automation_status));
    assert.equal(entry.operational_metadata.machine_rule_status, 'not_defined');
    assert.equal(entry.operational_metadata.export_capabilities.rego, false);
    assert.ok(entry.operational_metadata.review_interval_days >= 1);
    assert.match(entry.claims_boundary, /not an accredited certification/i);
  }
});

test('all applicability predicates have an authoritative provenance classification', () => {
  assert.equal(ARCHITECTURE_PREDICATE_REGISTRY.length, 66);
  assert.deepEqual(new Set(ARCHITECTURE_PREDICATE_REGISTRY.map((item) => item.key)), new Set(ARCHITECTURE_FACT_KEYS));
  const allowed = new Set(['user-answerable','derived-from-answer','system-observed','project-metadata-derived','manual-review-only']);
  for (const item of ARCHITECTURE_PREDICATE_REGISTRY) {
    assert.ok(allowed.has(item.classification), item.key);
    assert.ok(item.justification.length > 20, item.key);
  }
});

test('all 108 controls have distinct evidence and retest blocks with complete test fields', () => {
  for (const field of ['pass_condition','fail_condition']) assert.equal(new Set(asset.entries.map((entry) => entry.check[field])).size, 108, field);
  for (const field of ['required_evidence']) assert.equal(new Set(asset.entries.map((entry) => JSON.stringify(entry.check[field]))).size, 108, field);
  for (const field of ['implementation_principles','retest_acceptance']) assert.equal(new Set(asset.entries.map((entry) => JSON.stringify(entry.solution[field]))).size, 108, field);
  for (const entry of asset.entries) {
    for (const field of ['preconditions','positive_test','negative_test','required_identities','required_inputs_and_expected_outputs','safe_testing_constraints']) assert.ok(entry.check[field]?.length, `${entry.id} ${field}`);
    for (const field of ['immediate_containment','root_cause_remediation','preventive_control','monitoring','rollback_considerations','retest_requirements','evidence_required_to_close']) assert.ok(entry.solution[field]?.length, `${entry.id} ${field}`);
  }
});

test('all original applicability labels have structured translations', () => {
  const unresolved = asset.entries.flatMap((entry) => entry.applicability_profile.unresolved_labels || []);
  assert.deepEqual(unresolved, []);
  const usedFacts = new Set(asset.entries.flatMap((entry) => entry.applicability_profile.clauses.flatMap((clause) => clause.predicates || []).map((predicate) => predicate.fact)).filter((fact) => fact && fact !== 'always'));
  for (const fact of usedFacts) assert.ok(ARCHITECTURE_FACT_KEYS.includes(fact), `missing allowed architecture fact ${fact}`);
});

test('unknown architecture facts remain review-required and camelCase database profiles work', () => {
  const entry = asset.entries.find((item) => item.id === 'ARL-KB-055');
  assert.equal(evaluateApplicability(entry, {}).status, 'unknown');
  assert.equal(evaluateApplicability(entry, { uses_state_changing_tools: true }).status, 'applicable');
  assert.equal(evaluateApplicability(entry, { uses_state_changing_tools: false }).status, 'not_applicable');
  assert.equal(evaluateApplicability({ applicabilityProfile: entry.applicability_profile }, { uses_state_changing_tools: true }).status, 'applicable');
});

test('architecture fact API rejects malformed and unknown values', () => {
  assert.equal(validateArchitectureFacts({ uses_tools: true, uses_mcp: null }).uses_tools, true);
  assert.throws(() => validateArchitectureFacts([]), /must be an object/i);
  assert.throws(() => validateArchitectureFacts({ uses_tools: 'yes' }), /true, false or null/i);
  assert.throws(() => validateArchitectureFacts({ invented_fact: true }), /unsupported architecture fact/i);
});

test('critical evidence failures cannot be averaged away and not-applicable entries do not pollute evidence counts', () => {
  const summary = summarizeEvidenceReadiness([
    { applicabilityStatus: 'not_applicable', evidenceState: 'finding_open', criticalGateFailed: false },
    { applicabilityStatus: 'applicable', evidenceState: 'retest_passed', criticalGateFailed: false },
    { applicabilityStatus: 'applicable', evidenceState: 'finding_open', criticalGateFailed: true },
    ...Array.from({ length: 20 }, () => ({ applicabilityStatus: 'applicable', evidenceState: 'test_passed', criticalGateFailed: false })),
  ]);
  assert.equal(summary.notApplicable, 1);
  assert.equal(summary.openFindings, 1);
  assert.equal(summary.failedCriticalGates, 1);
  assert.equal(summary.deploymentGate, 'do_not_deploy');
});

test('manifest exports preserve limitations and Rego remains blocked without verified semantics', () => {
  const entry = asset.entries[0];
  const manifest = buildControlManifest(entry);
  assert.equal(manifest.entryId, entry.id);
  assert.match(manifest.limitations, /not an accredited certification/i);
  assert.match(toYaml(manifest), /entryId:/);
  assert.throws(() => assertRegoExportAllowed(entry), /no verified executable rule/i);
  assert.doesNotThrow(() => assertRegoExportAllowed({ operationalMetadata: { machineRuleStatus: 'verified', exportCapabilities: { rego: true } } }));
});

test('migrations are additive and create normalized lifecycle tables', () => {
  const base = read('009_risk_knowledge_asset.sql');
  const v11 = read('011_risk_knowledge_v1_1.sql');
  const lifecycle = read('013_risk_knowledge_evidence_lifecycle.sql');
  for (const table of ['risk_knowledge_entries','risk_knowledge_checks','risk_knowledge_solutions','risk_knowledge_references','risk_knowledge_mappings','risk_knowledge_links']) assert.match(base, new RegExp(`CREATE TABLE IF NOT EXISTS ${table}\\b`));
  for (const table of ['risk_knowledge_applicability_rules','risk_knowledge_operational_metadata','project_risk_knowledge_states']) assert.match(v11, new RegExp(`CREATE TABLE IF NOT EXISTS ${table}\\b`));
  for (const table of ['risk_knowledge_validation_records','risk_knowledge_predicate_registry','project_risk_context','risk_knowledge_entry_classification']) assert.match(lifecycle, new RegExp(`CREATE TABLE IF NOT EXISTS ${table}\\b`));
  const all = `${base}\n${v11}\n${lifecycle}`;
  assert.doesNotMatch(all, /\bDROP\s+(?:TABLE|COLUMN)\b/i);
  assert.doesNotMatch(all, /\bTRUNCATE\b/i);
});

test('public summary excludes exact checks but supports filters and local applicability profiling', () => {
  const pub = JSON.parse(read('risk-knowledge-public-v1.1.json'));
  assert.equal(pub.entries.length, 108);
  assert.equal(pub.entries[0].check, undefined);
  assert.equal(pub.entries[0].checks, undefined);
  assert.equal(pub.entries[0].pass_condition, undefined);
  assert.equal(pub.entries[0].problem.statement.length > 10, true);
  assert.ok(pub.entries[0].applicability_profile.clauses.length > 0);
  assert.ok(['verified','candidate','unsupported'].includes(pub.entries[0].operational_summary.automation_status));
});

test('website pages use the current external site shell and contain no inline styles', () => {
  const pages = ['risk-library.html','risk-library-detail.html','risk-profiler.html','risk-readiness.html'];
  for (const page of pages) {
    const html = read(page);
    assert.match(html, /site-header-v10/);
    assert.match(html, /data-site-header/);
    assert.match(html, /data-primary-navigation/);
    assert.match(html, /site-footer-v10/);
    assert.match(html, /site-shell\.js/);
    assert.match(html, /risk-knowledge\.css/);
    assert.doesNotMatch(html, /\sstyle\s*=/i);
    assert.doesNotMatch(html, /<script(?![^>]*\bsrc=)[^>]*>/i);
  }
});

test('service fails closed around ownership, evidence and caller-controlled gates', () => {
  const service = read('risk-knowledge.js');
  const api = read('API_INTEGRATION.md');
  assert.match(service, /subject ownership resolver is required/i);
  assert.match(service, /Referenced evidence subject was not found in this project/i);
  assert.match(service, /Evidence state .* requires a linked authoritative record/);
  assert.match(service, /links\.length/);
  assert.doesNotMatch(service, /evidenceCount\s*=\s*0/);
  assert.match(api, /Do \*\*not\*\* accept `deploymentGate`, `criticalGateFailed`, `evidenceCount`/);
  assert.match(api, /server-side resolver/);
});

test('knowledge content avoids unsupported certification claims', () => {
  const text = JSON.stringify(asset).toLowerCase();
  assert.doesNotMatch(text, /\bcertified secure\b|\bguaranteed secure\b|\beu ai act certified\b/);
});
