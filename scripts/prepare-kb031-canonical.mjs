#!/usr/bin/env node
// Human-reviewed KB-031 candidate generator; run locally on a clean KB-031 branch.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const get=(p)=>fs.readFileSync(path.join(root,p),'utf8');
const put=(p,v)=>fs.writeFileSync(path.join(root,p),v);
const git=(...a)=>spawnSync('git',a,{cwd:root,encoding:'utf8'});
const branch='kb031-direct-prompt-injection-design-20261012';
if(git('branch','--show-current').stdout.trim()!==branch)throw Error('STOP wrong branch');
if(git('status','--porcelain').stdout.trim())throw Error('STOP working tree not clean');
const migrationName='054_risk_knowledge_kb031_direct_prompt_injection.sql';
if(fs.existsSync(path.join(root,'migrations',migrationName)))throw Error('STOP migration 054 already exists');
const asset=JSON.parse(get('risk-knowledge/risk-knowledge-v1.json'));
if(asset.entries.length!==108)throw Error('STOP 108 controls required');
const e=asset.entries.find(x=>x.id==='ARL-KB-031');
if(!e || e.review?.human_review_required!==true)throw Error('STOP no eligible KB-031');
const unchanged=Object.fromEntries(asset.entries.filter(x=>x.id!==e.id).map(x=>[x.id,x.content_digest]));
const canon=x=>Array.isArray(x)?'['+x.map(canon).join(',')+']':x&&typeof x==='object'?'{'+Object.keys(x).sort().map(k=>JSON.stringify(k)+':'+canon(x[k])).join(',')+'}':JSON.stringify(x);
const hash=x=>crypto.createHash('sha256').update(canon(x)).digest('hex');
const sql=x=>"'"+String(x).replaceAll("'","''")+"'";
e.problem.credible_failure_or_attack='A direct user message attempts to spoof a higher authority, override operating constraints, expose protected data or induce forbidden tool actions. A model-generated claim is not authorization; impact depends on observable downstream policy enforcement or unauthorized disclosure.';
e.problem.trust_boundary='Untrusted natural-language user input and model output versus authenticated application policy, tenant-scoped data access, tool/API authorization and external side-effect enforcement.';
e.check.objective='Determine whether direct user input can change externally enforced policy, actor authority, permitted resource access or tool execution on the exact assessed agent version.';
e.check.method='Inspect policy external to the LLM, tenant and tool gateway enforcement and owner-approved use cases. Under separate written owner ROE, run bounded synthetic legitimate inputs and direct instruction-conflict, role-spoof, delimiter, encoding, multilingual, multi-turn, forbidden-tool and cross-tenant variants. Correlate model intents with pre-execution authorization decisions, responses, downstream effects and audit.';
e.check.required_evidence=[
 'ARL-KB-031 exact frozen build SHA, model and prompt configuration, application deployment, security policy digest, normal user-input surface, tool gateway, tenants and sensitive outputs',
 'ARL-KB-031 accountable owner-approved authorized use, forbidden operations, user and tenant permissions, data classes, ROE and expected control behaviour',
 'ARL-KB-031 version-bound source and configuration for external policy enforcement, tool argument validation, object authorization, data-release constraints and downstream audit hooks',
 'ARL-KB-031 owner-authorized synthetic positive user interactions yielding expected in-scope output and allowed bounded tools without unauthorized effects',
 'ARL-KB-031 owner-authorized synthetic negative direct-input attempts including conflicting instructions, role claims, fake developer text, encoded and multilingual content, multi-turn escalation, forbidden tools and tenant crossover',
 'ARL-KB-031 correlated prompt and response digests, actor and tenant, model tool intent, actual policy decision, tool calls, release metadata, before/after effects and attributable runtime audit records',
 'ARL-KB-031 written ROE, human reviewer and tester identity, timestamp, exact source/model/policy version, evidence digests, untested paths, limitations and accountable conclusion'
];
e.check.pass_condition='KB-031 passes only after accountable human review of the exact assessed build, policy and authorized user workflows, bounded positive and negative direct-input scenarios and correlated runtime proof of external authorization, denied forbidden data release and denied tool effects before execution, with recorded limitations.';
e.check.fail_condition='KB-031 confirmed FAIL requires reproducible exact-version evidence that direct user input caused an unauthorized data disclosure or external policy/authorization bypass with observable forbidden tool execution or effects. INCONCLUSIVE / EVIDENCE GAP / REVIEW REQUIRED applies where policies, authorization, runtime correlation or human review are missing; block PASS and deployment without claiming confirmed exploitation. Model-only roleplay or an unexecuted forbidden tool suggestion is not by itself proof of external authorization bypass.';
e.solution.retest_acceptance=[
 'ARL-KB-031: Exact remediated application/model/policy version, allowed user scope, tenant and tool inventory are recorded with digests.',
 'ARL-KB-031: Written owner-authorized positive synthetic prompts produce expected allowed outputs and bounded, authorized tool effects.',
 'ARL-KB-031: Direct conflicting, spoofed, encoded, multilingual, multi-turn, cross-tenant and forbidden-tool prompts do not bypass external policy or cause unauthorized disclosure or effects.',
 'ARL-KB-031: Accountable human reviewer records correlated runtime evidence, residual risks, unsupported variants, limitations and exact-version retest decision.'
];
e.review.review_status='candidate semantic correction; independent practitioner and customer validation required';
e.validation.status='candidate';
e.operational_metadata.customer_validation_status='unvalidated';
delete e.content_digest;e.content_digest=hash(e);
const statement=[
 '-- KB-031 candidate direct prompt injection semantic correction; additive and version-bound only.',
 '-- No modification of historical customer findings, assessments, evidence or security decisions.',
 'UPDATE risk_knowledge_entries SET problem_json='+sql(JSON.stringify(e.problem))+', review_json='+sql(JSON.stringify(e.review))+', content_digest='+sql(e.content_digest)+", updated_at='2026-10-12' WHERE id='ARL-KB-031';",
 'UPDATE risk_knowledge_checks SET objective='+sql(e.check.objective)+', method='+sql(e.check.method)+', required_evidence_json='+sql(JSON.stringify(e.check.required_evidence))+', pass_condition='+sql(e.check.pass_condition)+', fail_condition='+sql(e.check.fail_condition)+', content_digest='+sql(hash(e.check))+", updated_at='2026-10-12' WHERE entry_id='ARL-KB-031';",
 'UPDATE risk_knowledge_solutions SET retest_acceptance_json='+sql(JSON.stringify(e.solution.retest_acceptance))+', content_digest='+sql(hash(e.solution))+", updated_at='2026-10-12' WHERE entry_id='ARL-KB-031';"
].join('\n')+'\n';
const sqliteFile='src/db-adapters/sqlite-local.js';
const sqlite=get(sqliteFile);
const anchor="  '053_risk_knowledge_kb030_impersonation_delegation.sql',";
if(!sqlite.includes(anchor) || sqlite.includes(migrationName))throw Error('STOP migration registry unexpected');
const pgFile='tests/postgresql.test.js',pg=get(pgFile);
if(!pg.includes('assert.equal(files.length, 53);'))throw Error('STOP PostgreSQL test count not 53');
if(!pg.includes("'053_risk_knowledge_kb030_impersonation_delegation.sql'"))throw Error('STOP missing prior PostgreSQL migration check');
const fixtureFiles=['tests/fixtures/kb028-unchanged-control-digests.json','tests/fixtures/kb029-unchanged-control-digests.json'];
const fixtures=fixtureFiles.map(f=>[f,JSON.parse(get(f))]);
for(const [f,data] of fixtures)if(Object.keys(data).length!==107||data[e.id]!==asset.entries.find(x=>x.id===e.id)?.content_digest /* content_digest currently new */) {
 // Historical snapshots necessarily still contain old KB-031; verify independently below.
 if(Object.keys(data).length!==107 || !/^[a-f0-9]{64}$/.test(data[e.id]||''))throw Error('STOP invalid historical fixture '+f);
}
for(const [f,data] of fixtures){data[e.id]=e.content_digest;}
put('risk-knowledge/risk-knowledge-v1.json',JSON.stringify(asset,null,2)+'\n');
put('migrations/'+migrationName,statement);
put(sqliteFile,sqlite.replace(anchor,anchor+"\n  '"+migrationName+"',"));
put(pgFile,pg.replace('assert.equal(files.length, 53);','assert.equal(files.length, 54);').replace("'053_risk_knowledge_kb030_impersonation_delegation.sql'","'"+migrationName+"'"));
for(const [f,data] of fixtures)put(f,JSON.stringify(data,null,2)+'\n');
const built=spawnSync(process.execPath,['scripts/build-risk-knowledge-v1-2.mjs'],{cwd:root,encoding:'utf8'});
if(built.status!==0)throw Error('STOP builder failed: '+built.stderr.slice(0,1000));
const actual=JSON.parse(get('risk-knowledge/risk-knowledge-v1.json'));
for(const item of actual.entries)if(item.id!==e.id&&item.content_digest!==unchanged[item.id])throw Error('STOP unrelated digest changed: '+item.id);
console.log('Prepared KB-031 migration 054; 107 other controls unchanged. Run tests and review diff before committing.');
