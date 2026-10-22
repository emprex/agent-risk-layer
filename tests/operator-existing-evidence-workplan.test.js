import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import { existingEvidenceWorkplan, EXISTING_EVIDENCE_SUMMARY_SCHEMA }
  from '../src/agent/existing-evidence-workplan.mjs';

const SHA='a'.repeat(40);
const binding={projectId:'prj_synthetic',assessmentId:'asmt_synthetic'};
const scope={
  available:true,projectId:binding.projectId,systemSnapshotId:'sys_synthetic',
  targetBinding:{revision:SHA},securityStateChanged:false,
  deploymentDecisionWritten:false,humanReviewRequired:true
};
const summary={
  snapshotId:'sys_synthetic',controlsReviewed:98,excludedControls:10,criterionCount:416,
  summary:{
    staticCandidates:25,staticMissing:197,humanRequirements:119,
    runtimeRequirements:191,sourceLineageIssues:5,
    staticSourcePackets:1,humanDocumentPackets:1,
    runtimeValidationPackets:1,manualReviewPackets:0
  },
  packs:[
    {number:1,theme:'untrusted_collector_SECRETVALUE',taskCount:197,controlCount:71},
    {number:2,theme:'untrusted_human',taskCount:119,controlCount:64},
    {number:3,theme:'runtime',taskCount:191,controlCount:83}
  ],
  activeLineageExceptions:[{secret:'CUSTOMER_UNTRUSTED_EVIDENCE'}]
};
const requests={
  canonicalData:{
    assessmentEvidenceRequestSummary:summary,
    securityStateChanged:false,deploymentDecisionWritten:false,humanReviewRequired:true
  }
};
const input={frozenRevision:SHA,binding,scopeBefore:scope,scopeAfter:scope,requests};

test('read-only canonical evidence workplan exposes only bounded counts and work pack identifiers',()=>{
  const out=existingEvidenceWorkplan(input);
  assert.equal(out.schema,EXISTING_EVIDENCE_SUMMARY_SCHEMA);
  assert.equal(out.available,true);
  assert.equal(out.assessmentControls,98);
  assert.equal(out.otherWorkflowControls,10);
  assert.equal(out.criterionCount,416);
  assert.deepEqual(out.packs.map(x=>x.category),[
    'static_observation','human_document','runtime_authorisation'
  ]);
  assert.equal(out.evidenceAccepted,false);
  assert.equal(out.testsExecuted,0);
  assert.equal(out.passFailInferred,false);
  assert.equal(out.readinessDecision,'not_evaluated');
  assert.doesNotMatch(JSON.stringify(out),/SECRETVALUE|CUSTOMER_UNTRUSTED_EVIDENCE|untrusted_human/);
});
test('missing binding is never bootstrapped or interpreted as completed review',()=>{
  const out=existingEvidenceWorkplan({frozenRevision:SHA});
  assert.equal(out.available,false);
  assert.equal(out.reason,'not_found');
  assert.equal(out.humanReviewRequired,true);
});
test('evidence workplan refuses altered target, snapshot or authority flags',()=>{
  for(const variant of [
    {scopeAfter:{...scope,systemSnapshotId:'sys_other'}},
    {scopeAfter:{...scope,targetBinding:{revision:'b'.repeat(40)}}},
    {scopeBefore:{...scope,projectId:'prj_other'}},
    {requests:{canonicalData:{...requests.canonicalData,securityStateChanged:true}}},
    {requests:{canonicalData:{...requests.canonicalData,assessmentEvidenceRequestSummary:{
      ...summary,snapshotId:'sys_foreign'}}}},
    {requests:{canonicalData:{...requests.canonicalData,assessmentEvidenceRequestSummary:{
      ...summary,excludedControls:9}}}},
    {requests:{canonicalData:{...requests.canonicalData,assessmentEvidenceRequestSummary:{
      ...summary,summary:{...summary.summary,staticSourcePackets:2}}}}},
    {requests:{canonicalData:{...requests.canonicalData,assessmentEvidenceRequestSummary:{
      ...summary,packs:[...summary.packs.slice(0,2),{...summary.packs[2],number:8}]}}}}
  ]){
    assert.throws(()=>existingEvidenceWorkplan({...input,...variant}));
  }
});


test('evidence JSON lookup on a missing synthetic assessment never creates state',()=>{
  const child=spawnSync;
  const root=new URL('../',import.meta.url).pathname;
  const directory=fs.mkdtempSync(path.join(os.tmpdir(),'arl-evidence-readonly-'));
  const target=path.join(directory,'target');
  const sqlite=path.join(directory,'fixture.sqlite');
  fs.mkdirSync(target);
  const git=args=>child('git',['-C',target,...args],{encoding:'utf8',timeout:10000});
  const env={...process.env,NODE_ENV:'test',PRODUCT_STAGE:'development',
    DATABASE_URL:'',DATABASE_PATH:sqlite,ARL_EXPECTED_TARGET_SHA:''};
  try {
    for(const a of [
      ['init','-q'],['config','user.name','ARL synthetic'],
      ['config','user.email','synthetic@example.invalid'],
      ['config','commit.gpgsign','false']
    ])assert.equal(git(a).status,0);
    fs.writeFileSync(path.join(target,'README.md'),'Synthetic authorised fixture only\\n');
    assert.equal(git(['add','README.md']).status,0);
    assert.equal(git(['commit','-q','-m','fixture']).status,0);
    const setup=child(process.execPath,['--input-type=module','--eval',
      "const {initialiseDatabase}=await import('./src/db.js'); await initialiseDatabase();"
    ],{cwd:root,env,encoding:'utf8',timeout:20000});
    assert.equal(setup.status,0,setup.stderr);
    const run=child(process.execPath,[
      'src/agent/arl-inspect-existing-assessment.mjs','--evidence-json',target
    ],{cwd:root,env,encoding:'utf8',timeout:20000});
    assert.equal(run.status,0,run.stderr);
    const out=JSON.parse(run.stdout);
    assert.equal(out.schema,EXISTING_EVIDENCE_SUMMARY_SCHEMA);
    assert.equal(out.available,false);
    assert.equal(out.reason,'not_found');
    assert.equal(out.evidenceAccepted,false);
    assert.equal(out.testsExecuted,0);
    assert.equal(out.humanReviewRequired,true);
    const count=child(process.execPath,['--input-type=module','--eval',
      "const {db}=await import('./src/db.js'); const t=['users','security_projects','assessments','system_snapshots']; console.log((await Promise.all(t.map(x=>db.prepare('SELECT COUNT(*) AS n FROM '+x).get()))).map(y=>Number(y.n)).join(','));"
    ],{cwd:root,env,encoding:'utf8',timeout:20000});
    assert.equal(count.status,0,count.stderr);
    assert.equal(count.stdout.trim(),'0,0,0,0');
    const badSha=child(process.execPath,[
      'src/agent/arl-inspect-existing-assessment.mjs','--evidence-json',target
    ],{cwd:root,env:{...env,ARL_EXPECTED_TARGET_SHA:'0'.repeat(40)},
       encoding:'utf8',timeout:20000});
    assert.equal(badSha.status,2);
    assert.equal(badSha.stdout.trim(),'');
    assert.equal(git(['status','--porcelain']).stdout.trim(),'');
  } finally {
    fs.rmSync(directory,{force:true,recursive:true});
  }
});