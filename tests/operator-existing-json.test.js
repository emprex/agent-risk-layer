import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { existingAssessmentSummary, EXISTING_ASSESSMENT_SUMMARY_SCHEMA }
  from '../src/agent/existing-assessment-summary.mjs';

const root=fileURLToPath(new URL('../',import.meta.url));
const SHA='a'.repeat(40);
const binding={projectId:'prj_synthetic',assessmentId:'asmt_synthetic'};
const view={
  available:true,projectId:binding.projectId,systemSnapshotId:'sys_synthetic',
  targetBinding:{revision:SHA},environment:'test',securityStateChanged:false,
  deploymentDecisionWritten:false,humanReviewRequired:true,
  architectureSummary:'PRIVATE_UNREVIEWED_SUMMARY',
  confirmedArchitectureFacts:['SECRET_SHOULD_NOT_BE_PROJECTED'],
  capabilityProfile:{untrusted:'PRIVATE_TOKEN'}
};

test('existing selection projection omits private context and security verdicts',()=>{
  const output=existingAssessmentSummary({view,binding,frozenRevision:SHA});
  assert.equal(output.schema,EXISTING_ASSESSMENT_SUMMARY_SCHEMA);
  assert.equal(output.available,true);
  assert.equal(output.projectId,binding.projectId);
  assert.equal(output.assessmentId,binding.assessmentId);
  assert.equal(output.systemSnapshotId,'sys_synthetic');
  assert.equal(output.securityVerdict,'not_assessed');
  assert.equal(output.evidenceState,'not_inspected');
  assert.equal(output.readinessDecision,'not_evaluated');
  assert.equal(output.humanReviewRequired,true);
  assert.doesNotMatch(JSON.stringify(output),/PRIVATE_|SECRET_/);
});

test('selection projection refuses mismatched SHAs and human authority flags',()=>{
  for(const changed of [
    {...view,targetBinding:{revision:'b'.repeat(40)}},
    {...view,projectId:'prj_another'},
    {...view,securityStateChanged:true},
    {...view,humanReviewRequired:false},
    {...view,systemSnapshotId:''}
  ]){
    assert.throws(()=>existingAssessmentSummary({view:changed,binding,frozenRevision:SHA}));
  }
  const missing=existingAssessmentSummary({frozenRevision:SHA,reason:'not_found'});
  assert.deepEqual(missing.available,false);
  assert.equal(missing.reason,'not_found');
  assert.equal(missing.humanReviewRequired,true);
});

test('read-only --json lookup does not bootstrap missing synthetic assessment',()=>{
  const base=fs.mkdtempSync(path.join(os.tmpdir(),'arl-existing-json-'));
  const target=path.join(base,'target');
  const dbFile=path.join(base,'test.sqlite');
  fs.mkdirSync(target);
  const git=args=>spawnSync('git',['-C',target,...args],{encoding:'utf8'});
  const env={
    ...process.env,NODE_ENV:'test',PRODUCT_STAGE:'development',DATABASE_URL:'',
    DATABASE_PATH:dbFile,ARL_EXPECTED_TARGET_SHA:''
  };
  const run=(args,e=env)=>spawnSync(process.execPath,
    ['src/agent/arl-inspect-existing-assessment.mjs',...args],
    {cwd:root,env:e,encoding:'utf8',timeout:20000});
  try {
    for(const args of [
      ['init','-q'],['config','user.name','ARL synthetic'],
      ['config','user.email','test@example.invalid'],
      ['config','commit.gpgsign','false']
    ])assert.equal(git(args).status,0);
    fs.writeFileSync(path.join(target,'README.md'),'synthetic only\n');
    assert.equal(git(['add','README.md']).status,0);
    assert.equal(git(['commit','-q','-m','fixture']).status,0);

    const setup=spawnSync(process.execPath,['--input-type=module','--eval',
      "const {initialiseDatabase}=await import('./src/db.js'); await initialiseDatabase();"
    ],{cwd:root,env,encoding:'utf8',timeout:20000});
    assert.equal(setup.status,0,setup.stderr);

    const response=run(['--json',target]);
    assert.equal(response.status,0,response.stderr);
    const output=JSON.parse(response.stdout);
    assert.equal(output.schema,EXISTING_ASSESSMENT_SUMMARY_SCHEMA);
    assert.equal(output.available,false);
    assert.equal(output.reason,'not_found');
    assert.equal(output.securityVerdict,'not_assessed');
    assert.equal(output.humanReviewRequired,true);
    assert.doesNotMatch(response.stdout,/PRIVATE_|password_hash|ARCHITECTURE/i);

    const count=spawnSync(process.execPath,['--input-type=module','--eval',
      "const {db}=await import('./src/db.js'); const t=['users','security_projects','assessments','system_snapshots']; console.log((await Promise.all(t.map(x=>db.prepare('SELECT COUNT(*) AS n FROM '+x).get()))).map(y=>Number(y.n)).join(','));"
    ],{cwd:root,env,encoding:'utf8',timeout:20000});
    assert.equal(count.status,0,count.stderr);
    assert.equal(count.stdout.trim(),'0,0,0,0');

    const mismatch=run(['--json',target],
      {...env,ARL_EXPECTED_TARGET_SHA:'0'.repeat(40)});
    assert.equal(mismatch.status,2);
    assert.equal(mismatch.stdout.trim(),'');

    fs.appendFileSync(path.join(target,'README.md'),'changed but uncommitted\n');
    const dirty=run(['--json',target]);
    assert.equal(dirty.status,2);
    assert.equal(dirty.stdout.trim(),'');
  }finally{
    fs.rmSync(base,{recursive:true,force:true});
  }
});
