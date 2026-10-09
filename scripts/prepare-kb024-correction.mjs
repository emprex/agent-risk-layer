#!/usr/bin/env node
// Owner-reviewed KB-024 semantic migration preparer. Run on a clean working tree.
// Run: node scripts/prepare-kb024-correction.mjs
// Then inspect all derived diffs, run checks and commit together. Never deploy automatically.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';

const root = path.resolve(import.meta.dirname, '..');
const assetPath = path.join(root, 'risk-knowledge/risk-knowledge-v1.json');
const migrationPath = path.join(root, 'migrations/047_risk_knowledge_kb024_object_authorization.sql');
if (fs.existsSync(migrationPath)) throw new Error('Migration 047 already exists: inspect first.');
const asset = JSON.parse(fs.readFileSync(assetPath, 'utf8'));
const entry = asset.entries.find(e => e.id === 'ARL-KB-024');
if (!entry || entry.validation.status !== 'candidate') throw new Error('Unexpected KB024 baseline');
if (asset.entries.length !== 108) throw new Error('Unexpected control count; review canonical asset before regeneration.');
const otherDigests = new Map(asset.entries.filter(e => e.id !== 'ARL-KB-024').map(e => [e.id, e.content_digest]));
const evidence = [
  'ARL-KB-024 exact assessed system, build version, environment, tenant, workspace, synthetic identities, object types and protected operation scope',
  'ARL-KB-024 organisation-approved actor, role, tenant, ownership and object-operation authorization matrix with accountable policy owner',
  'ARL-KB-024 server-side source or configuration evidence for object-scoped queries, alternate routes, service identities and fail-closed authorization checks',
  'ARL-KB-024 bounded positive evidence of approved synthetic same-tenant object reads, changes, exports and deletes, with observed outputs and object state',
  'ARL-KB-024 bounded negative evidence of cross-user, cross-tenant, identifier-swap, alternate-route and missing-policy requests denied before any data exposure or side effect',
  'ARL-KB-024 observed runtime authorization decisions, response payload checks, before-and-after object state and downstream audit events proving allow and deny outcomes',
  'ARL-KB-024 tester and reviewer identity, roles, timestamps, exact version, evidence digest, exceptions and accountable human decision'
];
if (entry.check.required_evidence.length !== 5) throw new Error('Unexpected evidence baseline');
entry.problem.credible_failure_or_attack = 'An authenticated actor or service identity can access another principal or tenant\'s object through direct or indirect identifiers, alternate routes or missing server-side object authorization.';
entry.problem.affected_assets = ['tenant and workspace-scoped objects', 'object identifiers and ownership relationships', 'assessment evidence, approvals and reports', 'service identities and authorization audit events'];
entry.problem.trust_boundary = 'Between the authenticated principal and server-enforced tenant, ownership and operation-level authorization for each object access.';
entry.check.objective = 'Determine whether server-side object authorization denies access outside the authenticated actor, tenant, ownership and allowed operation for each read, update, export and delete path.';
entry.check.method = 'Inspect the owner-approved role/object-operation matrix and server-side query guards. With separate written owner authorization, use synthetic staging identities and objects to exercise bounded positive operations and denied cross-user, cross-tenant, swapped-ID, alternate-route, service-identity and missing-policy variants. Correlate decisions, response payloads, object state and audit trails.';
entry.check.required_evidence = evidence;
entry.check.pass_condition = 'KB-024 passes only after accountable human review establishes exact-version authorization policy and server enforcement, successful authorized object operations, denied cross-user and cross-tenant direct or alternate access before any payload leakage or side effect, and corroborating runtime/audit evidence with documented limitations.';
entry.check.fail_condition = 'KB-024 fails or requires review if unauthorized object access, information disclosure, export or mutation occurs; if authorization is UI-only, based on caller-supplied ownership, or fails open through alternate paths; or if exact-version negative tests, runtime observations or human review are missing.';
entry.check.positive_test = 'Using an authorized synthetic identity, verify each approved read, update, export and delete within the exact tenant and ownership scope, including expected response and final object state.';
entry.check.negative_test = 'Using other synthetic users, tenants and service identities, swap object identifiers or use alternate methods/routes and missing-policy scenarios; verify denial before response data exposure, export or mutation, with correlated audit events.';
entry.check.required_inputs_and_expected_outputs = [
 'Authorized identity/object/operation combinations yield exactly approved scoped output and observable state changes.',
 'Cross-user, cross-tenant, indirect identifier, alternate-route and missing-policy combinations are denied before data exposure or side effects.'
];
entry.solution.retest_acceptance = [
 'ARL-KB-024: Exact revised object-authorization policy, ownership matrix, deployed version and relevant digests are recorded.',
 'ARL-KB-024: Synthetic in-scope object operations succeed with expected outputs and recorded before-and-after state.',
 'ARL-KB-024: Cross-user, cross-tenant, identifier-swap, alternate-route and missing-policy attempts fail closed with no unauthorized payload or side effect and correlated audit records.',
 'ARL-KB-024: An accountable human reviewer records test limitations, exceptions, residual risk and the exact-version retest decision.'
];
entry.solution.retest_requirements = 'Repeat the exact object-level failure against the remediated version, plus synthetic cross-user, cross-tenant, alternate-route, identifier-swap and missing-policy variants; confirm no disclosure or side effects and retain audit evidence before human deployment review.';
entry.review.last_reviewed = '2026-10-09';
entry.review.review_status = 'owner-approved semantic correction proposal; customer and independent practitioner validation required';
entry.review.change_triggers = [
 'ARL-KB-024 object ownership, tenancy, authorization policy or query change',
 'ARL-KB-024 new direct, indirect, export or service-method object route',
 'ARL-KB-024 cross-tenant or cross-user access or fail-open incident',
 'ARL-KB-024 assessed build, scope or evidence expiry change'
];
fs.writeFileSync(assetPath, JSON.stringify(asset,null,2)+'\n');
execFileSync(process.execPath, ['scripts/build-risk-knowledge-v1-2.mjs'], {cwd:root,stdio:'inherit'});
const builtAsset = JSON.parse(fs.readFileSync(assetPath,'utf8'));
const updated = builtAsset.entries.find(e=>e.id==='ARL-KB-024');
for (const other of builtAsset.entries) {
 if (other.id !== 'ARL-KB-024' && otherDigests.get(other.id) !== other.content_digest) {
  throw new Error('Unrelated control digest changed: '+other.id);
 }
}
const canonical = x => Array.isArray(x) ? '['+x.map(canonical).join(',')+']' : x && typeof x==='object' ? '{'+Object.keys(x).sort().map(k=>JSON.stringify(k)+':'+canonical(x[k])).join(',')+'}' : JSON.stringify(x);
const digest = x => crypto.createHash('sha256').update(canonical(x)).digest('hex');
const q = v => "'"+String(v??'').replaceAll("'","''")+"'";
const id = q('ARL-KB-024');
const sql = [
 '-- KB-024 object-level authorization semantic correction. Additive; historical migrations untouched.',
 '-- Does not change target assessments, findings, evidence or deployment decisions.',
 `UPDATE risk_knowledge_entries SET problem_json=${q(JSON.stringify(updated.problem))}, review_json=${q(JSON.stringify(updated.review))}, content_digest=${q(updated.content_digest)}, updated_at='2026-10-09' WHERE id=${id};`,
 `UPDATE risk_knowledge_checks SET objective=${q(updated.check.objective)}, method=${q(updated.check.method)}, required_evidence_json=${q(JSON.stringify(updated.check.required_evidence))}, pass_condition=${q(updated.check.pass_condition)}, fail_condition=${q(updated.check.fail_condition)}, content_digest=${q(digest(updated.check))}, updated_at='2026-10-09' WHERE entry_id=${id};`,
 `UPDATE risk_knowledge_solutions SET retest_acceptance_json=${q(JSON.stringify(updated.solution.retest_acceptance))}, content_digest=${q(digest(updated.solution))}, updated_at='2026-10-09' WHERE entry_id=${id};`
];
fs.writeFileSync(migrationPath,sql.join('\n')+'\n');
console.log('KB-024 prepared. Inspect changes, wire migration 047 into SQLite bootstrap and run complete CI before merge.');
