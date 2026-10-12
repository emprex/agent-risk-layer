#!/usr/bin/env node
// Local-only, owner-reviewed candidate KB-030 canonical correction.
// Run on the KB-030 branch with a clean working tree; do not run against customer data.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const jsonPath=path.join(root,'risk-knowledge/risk-knowledge-v1.json');
const sqlitePath=path.join(root,'src/db-adapters/sqlite-local.js');
const migrationPath=path.join(root,'migrations/053_risk_knowledge_kb030_impersonation_delegation.sql');
const expectedBranch='kb030-impersonation-delegation-design-20261012';
const git=(...args)=>spawnSync('git',args,{cwd:root,encoding:'utf8'});
const branch=git('branch','--show-current');
if(branch.status!==0 || branch.stdout.trim()!==expectedBranch) throw Error('STOP: expected KB-030 branch');
const status=git('status','--porcelain');
if(status.status!==0 || status.stdout.trim()) throw Error('STOP: working tree must be clean');
if(fs.existsSync(migrationPath)) throw Error('STOP: migration 053 already exists');
const asset=JSON.parse(fs.readFileSync(jsonPath,'utf8'));
if(asset.entries.length!==108) throw Error('STOP: expected 108 controls');
const entry=asset.entries.find(e=>e.id==='ARL-KB-030');
if(!entry || entry.review?.human_review_required!==true) throw Error('STOP: missing candidate control/human review');
const otherDigests=Object.fromEntries(asset.entries.filter(e=>e.id!==entry.id).map(e=>[e.id,e.content_digest]));
const canonical=v=>Array.isArray(v)?'['+v.map(canonical).join(',')+']':v&&typeof v==='object'?'{'+Object.keys(v).sort().map(k=>JSON.stringify(k)+':'+canonical(v[k])).join(',')+'}':JSON.stringify(v);
const digest=v=>crypto.createHash('sha256').update(canonical(v)).digest('hex');
const sql=v=>"'"+String(v).replaceAll("'","''")+"'";
const requirements=[
 'ARL-KB-030 exact frozen build SHA, deployed environment, identity and tenant scope, delegated endpoints, agent/tool/MCP gateways, queues, jobs and audit sinks',
 'ARL-KB-030 approved actor/delegate/subject, tenant, operation and resource policy with purpose, consent or authorised exception as applicable, privilege ceiling, expiry, revocation and accountable policy owner',
 'ARL-KB-030 version-bound source and configuration of independent actor and subject identity, receiving-end authorization, approval binding, scoped delegation, session visibility, replay prevention, worker enforcement and fail-closed expiry',
 'ARL-KB-030 bounded positive synthetic staging evidence of owner-authorised delegation and termination, approved scope, expected outputs and downstream changes',
 'ARL-KB-030 bounded negative synthetic staging evidence of missing approval, wrong actor or subject, wrong tenant, scope escalation, self-approval, expired or revoked delegation, replay, queued job and direct gateway bypass denied before disclosure or effects',
 'ARL-KB-030 correlated runtime evidence of initiator, subject, purpose, policy digest, approval, tenant, authorization decision, tool/worker execution, relevant response and before/after state with attributable audit records',
 'ARL-KB-030 written owner authorisation, tester and independent reviewer role, exact version and evidence digest, exceptions, unsupported paths, limitations and accountable human conclusion'
];
entry.problem.credible_failure_or_attack='An operator, service or compromised AI agent may assume another subject identity or forward a delegated authorization outside its approved actor, tenant, resource, operation, purpose, privilege ceiling or validity window, allowing unauthorized downstream action or disclosure.';
entry.problem.trust_boundary='Between initiating actor, delegated subject and each service, MCP/tool, job, API and audit enforcement point that must independently verify authority before effect.';
entry.check.objective='Determine whether impersonation and delegated authority remain explicitly approved, scoped, time-bounded, independently enforced, revocable and attributable on the exact assessed build.';
entry.check.method='Review owner-approved impersonation and delegation policy and version-bound enforcement. With separate written owner authorization, run bounded synthetic same-tenant allowed scenarios plus wrong-actor, wrong-subject, cross-tenant, privilege escalation, missing approval, replay, expired/revoked and queued-work scenarios. Correlate responses, tool/job effects and audit lineage.';
entry.check.required_evidence=requirements;
entry.check.pass_condition='KB-030 passes only after accountable human review of the exact build, approved actor/subject delegation and privilege ceiling, bounded synthetic allowed and denied scenarios, expiration and revocation, and correlated runtime evidence showing no unauthorized data disclosure or downstream effect on applicable scoped paths.';
entry.check.fail_condition='KB-030 is a confirmed FAIL only when exact-version corroborated evidence demonstrates unauthorized impersonation, cross-tenant delegation, scope escalation, forbidden disclosure or downstream effect, or an executable delegation path that demonstrably fails open. Missing owner policy, exact-version tests, runtime correlation or accountable signoff require INCONCLUSIVE / EVIDENCE GAP / REVIEW REQUIRED: block PASS and deployment without claiming a confirmed vulnerability.';
entry.solution.retest_acceptance=[
 'ARL-KB-030: Exact remediated build, delegated actor/subject policy, scope, tenant, exception conditions and digests are recorded.',
 'ARL-KB-030: Written owner-authorized synthetic permitted impersonation and delegation actions remain within scope with expected response and attributable downstream audit.',
 'ARL-KB-030: Synthetic wrong actor, subject, tenant, privilege, approval, replay, revoked and expired variants fail closed before disclosure or side effect across applicable service and queued paths.',
 'ARL-KB-030: Accountable human reviewer records exact-version retest evidence, exceptional modes, unsupported paths, limitations and final decision.'
];
entry.review.review_status='candidate semantic correction; independent practitioner and customer validation required';
entry.validation.status='candidate';
entry.operational_metadata.customer_validation_status='unvalidated';
delete entry.content_digest;entry.content_digest=digest(entry);
for(const e of asset.entries){if(e.id!==entry.id && e.content_digest!==otherDigests[e.id]) throw Error('STOP: unrelated control changed');}
const migration=[
 '-- KB-030 candidate impersonation and delegation evidence semantics; additive migration only.',
 '-- Does not update customer evidence, findings, assessments or deployment decisions.',
 'UPDATE risk_knowledge_entries SET problem_json='+sql(JSON.stringify(entry.problem))+', review_json='+sql(JSON.stringify(entry.review))+', content_digest='+sql(entry.content_digest)+", updated_at='2026-10-12' WHERE id='ARL-KB-030';",
 'UPDATE risk_knowledge_checks SET objective='+sql(entry.check.objective)+', method='+sql(entry.check.method)+', required_evidence_json='+sql(JSON.stringify(entry.check.required_evidence))+', pass_condition='+sql(entry.check.pass_condition)+', fail_condition='+sql(entry.check.fail_condition)+', content_digest='+sql(digest(entry.check))+", updated_at='2026-10-12' WHERE entry_id='ARL-KB-030';",
 'UPDATE risk_knowledge_solutions SET retest_acceptance_json='+sql(JSON.stringify(entry.solution.retest_acceptance))+', content_digest='+sql(digest(entry.solution))+", updated_at='2026-10-12' WHERE entry_id='ARL-KB-030';"
].join('\n')+'\n';
const sqlite=fs.readFileSync(sqlitePath,'utf8');
const prior="  '052_risk_knowledge_kb029_principal_accountability.sql',";
if(!sqlite.includes(prior) || sqlite.includes('053_risk_knowledge_kb030_impersonation_delegation.sql')) throw Error('STOP: migration registry changed');
const outSqlite=sqlite.replace(prior,prior+"\n  '053_risk_knowledge_kb030_impersonation_delegation.sql',");
const original=fs.readFileSync(jsonPath,'utf8');
try{
 fs.writeFileSync(jsonPath,JSON.stringify(asset,null,2)+'\n');
 fs.writeFileSync(migrationPath,migration);
 fs.writeFileSync(sqlitePath,outSqlite);
 const built=spawnSync(process.execPath,['scripts/build-risk-knowledge-v1-2.mjs'],{cwd:root,encoding:'utf8'});
 if(built.status!==0)throw Error('Canonical builder failed: '+built.stderr.slice(0,3000));
 const actual=JSON.parse(fs.readFileSync(jsonPath,'utf8'));
 for(const e of actual.entries)if(e.id!=='ARL-KB-030'&&e.content_digest!==otherDigests[e.id])throw Error('Unrelated signed control mutated: '+e.id);
 console.log('KB-030 candidate migration 053 built; 107 unaffected digests preserved; run full CI before merging.');
}catch(error){
 // Leave candidate workspace for inspection, never roll back unrelated changes or assert success.
 console.error('STOP: build unsuccessful; inspect git diff. '+error.message);
 process.exitCode=1;
}
