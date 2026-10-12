#!/usr/bin/env node
// Human-reviewed KB-032 candidate generator; run locally on a clean KB-032 branch.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const get=(p)=>fs.readFileSync(path.join(root,p),'utf8');
const put=(p,v)=>fs.writeFileSync(path.join(root,p),v);
const git=(...a)=>spawnSync('git',a,{cwd:root,encoding:'utf8'});
const branch='kb032-indirect-prompt-injection-design-20261012';
if(git('branch','--show-current').stdout.trim()!==branch)throw Error('STOP wrong branch');
if(git('status','--porcelain').stdout.trim())throw Error('STOP working tree not clean');
const migrationName='055_risk_knowledge_kb032_indirect_prompt_injection.sql';
if(fs.existsSync(path.join(root,'migrations',migrationName)))throw Error('STOP migration 055 already exists');
const asset=JSON.parse(get('risk-knowledge/risk-knowledge-v1.json'));
if(asset.entries.length!==108)throw Error('STOP 108 controls required');
const e=asset.entries.find(x=>x.id==='ARL-KB-032');
if(!e || e.review?.human_review_required!==true)throw Error('STOP no eligible KB-032');
const unchanged=Object.fromEntries(asset.entries.filter(x=>x.id!==e.id).map(x=>[x.id,x.content_digest]));
const canon=x=>Array.isArray(x)?'['+x.map(canon).join(',')+']':x&&typeof x==='object'?'{'+Object.keys(x).sort().map(k=>JSON.stringify(k)+':'+canon(x[k])).join(',')+'}':JSON.stringify(x);
const hash=x=>crypto.createHash('sha256').update(canon(x)).digest('hex');
const sql=x=>"'"+String(x).replaceAll("'","''")+"'";
e.problem.credible_failure_or_attack='An adversary embeds instructions in lower-trust email, documents, web pages, retrieved text, tickets or tool responses. An agent mistakes that material for higher-priority direction, which may cause unauthorized tool actions, information disclosure or goal changes. Textual compliance alone does not establish a downstream authorization bypass.';
e.problem.trust_boundary='Untrusted external content across ingestion, retrieval and model context versus separately authenticated actor authority, tool/API access policy, tenant data boundaries and side-effect controls.';
e.check.objective='Determine whether instructions originating in external content can cross the data/instruction boundary and bypass independently enforced policy, tenant authorization or tool-effect restrictions on the exact assessed version.';
e.check.method='Inspect provenance preservation, ingestion and retrieval, model/tool gateways and external policy checks. With separate written owner authorization, use synthetic documents, retrieved passages, messages, pages and tool responses carrying ordinary data or embedded conflicting instructions, including hidden-format, role spoofing, encoded, multilingual, cross-document and delayed variants. Correlate actual decisions and downstream effects to content digests.';
e.check.required_evidence=[
 'ARL-KB-032 frozen source SHA, deployed model/prompt and security-policy versions, untrusted source inventory, ingestion, retrieval, context, gateway, tenant and output boundary trace',
 'ARL-KB-032 owner-approved allowed content use, actor and tenant permissions, downstream tools and data release policy, prohibited instructions and written test ROE',
 'ARL-KB-032 version-bound source and configuration showing provenance and content/instruction separation, retrieval and sanitation as applicable, independent receiving-end tool and tenant authorization',
 'ARL-KB-032 owner-authorized synthetic positive workflows using safe documents, messages, retrieved chunks and tool responses with expected allowed outcomes and no out-of-scope effects',
 'ARL-KB-032 owner-authorized synthetic negative injection attempts in email, HTML or Markdown, documents, search results, tickets and tool outputs, including authority spoofing, hidden, encoded, multilingual, chained and delayed variants',
 'ARL-KB-032 correlated external source ID and digest, ingestion/retrieval/context trace, principal and tenant, model intent, independent policy decision, tool execution, data release metadata, before/after state and audit',
 'ARL-KB-032 written owner authorization, tester and accountable human reviewer, timestamp, exact version, evidence digests, source/format coverage, limitations, residual risks and final conclusion'
];
e.check.pass_condition='KB-032 passes only after accountable human review of exact-version written-ROE synthetic allowed and adverse external-content scenarios, source provenance, independently enforced policy, correlated actual tool/data-release decisions and no unauthorized effect on covered paths, with explicit limitations.';
e.check.fail_condition='KB-032 confirmed FAIL requires reproducible exact-version correlated evidence that instructions from external content caused unauthorized data disclosure, tool/action effects, or a verified external authorization bypass. INCONCLUSIVE / EVIDENCE GAP / REVIEW REQUIRED applies when ROE, provenance, coverage, runtime correlation, version match or accountable review is missing: block PASS and deployment without claiming a confirmed vulnerability. Mere model repetition of injected text is insufficient proof of a downstream bypass.';
e.solution.retest_acceptance=[
 'ARL-KB-032: Frozen remediated build, model/policy version, source provenance and allowed external-content use are recorded with digests.',
 'ARL-KB-032: Owner-authorized synthetic ordinary email, document, retrieval and tool-result data produce expected allowed results within actor/tenant scope.',
 'ARL-KB-032: Negative embedded instruction, authority-spoof, hidden, encoded, multilingual, chained and delayed content variants do not bypass external authorization or cause forbidden disclosure or side effects.',
 'ARL-KB-032: Accountable human reviewer records runtime correlation, tested source coverage, residual risk, limitations and exact-version retest decision.'
];
e.review.review_status='candidate semantic correction; independent practitioner and customer validation required';
e.validation.status='candidate';
e.operational_metadata.customer_validation_status='unvalidated';
const previousDigest=e.content_digest;
delete e.content_digest;e.content_digest=hash(e);
const statement=[
 '-- KB-032 candidate indirect prompt injection semantic correction; additive and version-bound only.',
 '-- No modification of historical customer findings, assessments, evidence or security decisions.',
 'UPDATE risk_knowledge_entries SET problem_json='+sql(JSON.stringify(e.problem))+', review_json='+sql(JSON.stringify(e.review))+', content_digest='+sql(e.content_digest)+", updated_at='2026-10-12' WHERE id='ARL-KB-032';",
 'UPDATE risk_knowledge_checks SET objective='+sql(e.check.objective)+', method='+sql(e.check.method)+', required_evidence_json='+sql(JSON.stringify(e.check.required_evidence))+', pass_condition='+sql(e.check.pass_condition)+', fail_condition='+sql(e.check.fail_condition)+', content_digest='+sql(hash(e.check))+", updated_at='2026-10-12' WHERE entry_id='ARL-KB-032';",
 'UPDATE risk_knowledge_solutions SET retest_acceptance_json='+sql(JSON.stringify(e.solution.retest_acceptance))+', content_digest='+sql(hash(e.solution))+", updated_at='2026-10-12' WHERE entry_id='ARL-KB-032';"
].join('\n')+'\n';
const sqliteFile='src/db-adapters/sqlite-local.js';
const sqlite=get(sqliteFile);
const anchor="  '054_risk_knowledge_kb031_direct_prompt_injection.sql',";
if(!sqlite.includes(anchor) || sqlite.includes(migrationName))throw Error('STOP migration registry unexpected');
const pgFile='tests/postgresql.test.js',pg=get(pgFile);
if(!pg.includes('assert.equal(files.length, 54);'))throw Error('STOP PostgreSQL test count not 53');
if(!pg.includes("'054_risk_knowledge_kb031_direct_prompt_injection.sql'"))throw Error('STOP missing prior PostgreSQL migration check');
const fixtureFiles=['tests/fixtures/kb028-unchanged-control-digests.json','tests/fixtures/kb029-unchanged-control-digests.json'];
const fixtures=fixtureFiles.map(f=>[f,JSON.parse(get(f))]);
const originalDigest=previousDigest;
for(const [f,data] of fixtures){if(Object.keys(data).length!==107 || data[e.id]!==originalDigest)throw Error('STOP historical fixture baseline mismatch '+f);}
for(const [f,data] of fixtures){data[e.id]=e.content_digest;}
put('risk-knowledge/risk-knowledge-v1.json',JSON.stringify(asset,null,2)+'\n');
put('migrations/'+migrationName,statement);
put(sqliteFile,sqlite.replace(anchor,anchor+"\n  '"+migrationName+"',"));
put(pgFile,pg.replace('assert.equal(files.length, 54);','assert.equal(files.length, 55);').replace("'054_risk_knowledge_kb031_direct_prompt_injection.sql'","'"+migrationName+"'"));
for(const [f,data] of fixtures)put(f,JSON.stringify(data,null,2)+'\n');
const built=spawnSync(process.execPath,['scripts/build-risk-knowledge-v1-2.mjs'],{cwd:root,encoding:'utf8'});
if(built.status!==0)throw Error('STOP builder failed: '+built.stderr.slice(0,1000));
const actual=JSON.parse(get('risk-knowledge/risk-knowledge-v1.json'));
for(const item of actual.entries)if(item.id!==e.id&&item.content_digest!==unchanged[item.id])throw Error('STOP unrelated digest changed: '+item.id);
console.log('Prepared KB-032 migration 055; 107 other controls unchanged. Run tests and review diff before committing.');
