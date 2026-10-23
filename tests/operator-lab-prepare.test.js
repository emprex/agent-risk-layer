import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { DatabaseSync } from 'node:sqlite';
import { fileURLToPath } from 'node:url';

const root=fileURLToPath(new URL('../',import.meta.url));
const script='src/agent/arl-prepare-lab-assessment.mjs';

function command(args,env){
  return spawnSync(process.execPath,[script,...args],{
    cwd:root,env:{...process.env,...env},
    encoding:'utf8',timeout:45_000
  });
}

function fixture(){
  const base=fs.mkdtempSync(path.join(os.tmpdir(),'arl-operator-lab-prep-'));
  const target=path.join(base,'synthetic-target');
  const sqlite=path.join(base,'fixture.sqlite');
  fs.mkdirSync(target);
  const git=(...args)=>spawnSync('git',['-C',target,...args],{
    encoding:'utf8',timeout:10_000
  });
  for(const args of [
    ['init','-q'],
    ['config','user.email','synthetic@example.invalid'],
    ['config','user.name','Synthetic Lab Operator']
  ])assert.equal(git(...args).status,0);
  fs.writeFileSync(path.join(target,'README.md'),'# Synthetic test-only AI agent\n');
  assert.equal(git('add','README.md').status,0);
  assert.equal(git('-c','commit.gpgsign=false','commit','-q','-m','lab fixture').status,0);
  const sha=git('rev-parse','HEAD').stdout.trim();
  assert.match(sha,/^[a-f0-9]{40}$/);
  const env={
    NODE_ENV:'test',
    PRODUCT_STAGE:'development',
    DATABASE_URL:'',
    DATABASE_PATH:sqlite,
    ARL_EXPECTED_TARGET_SHA:sha,
    ARL_OPERATOR_LAB_ONLY:'1',
    ARL_LAB_PREPARE_CONFIRMATION:'PREPARE LAB '+sha,
    ARL_OPERATOR_LAB_DATABASE_URL:'',
    ARL_AI_ADVISORY:'0',
    ARL_OPERATOR_OPEN_DASHBOARD:'0'
  };
  return {base,target,sqlite,sha,env,git,
    cleanup:()=>fs.rmSync(base,{recursive:true,force:true})};
}

test('isolated synthetic lab can create exactly one unknown snapshot; repeat is refused',()=>{
  const f=fixture();
  try{
    const first=command(['--lab-prepare',f.target],f.env);
    assert.equal(first.status,0,first.stderr);
    const result=JSON.parse(first.stdout);
    assert.equal(result.schema,'arl.operator.lab-preparation.v1');
    assert.equal(result.available,true);
    assert.equal(result.created,true);
    assert.equal(result.labOnly,true);
    assert.equal(result.targetRevision,f.sha);
    assert.equal(result.snapshotState,'unknown_requires_human_review');
    assert.equal(result.evidenceAccepted,false);
    assert.equal(result.testsExecuted,0);
    assert.equal(result.findingsApproved,false);
    assert.equal(result.readinessDecision,'HOLD');
    assert.equal(result.deploymentDecisionWritten,false);
    assert.equal(result.humanReviewRequired,true);

    const db=new DatabaseSync(f.sqlite,{readOnly:true});
    try{
      for(const table of ['users','security_projects','assessments','system_snapshots']){
        const row=db.prepare('SELECT COUNT(*) AS total FROM '+table).get();
        assert.equal(Number(row.total),1,table);
      }
      const snapshots=db.prepare('SELECT * FROM system_snapshots').all();
      assert.equal(snapshots.length,1);
      const payload=JSON.stringify(snapshots[0]);
      assert.match(payload,new RegExp(f.sha));
    } finally {db.close();}
    const again=command(['--lab-prepare',f.target],f.env);
    assert.equal(again.status,2);
    assert.equal(again.stdout.trim(),'');
    assert.equal(f.git('status','--porcelain').stdout.trim(),'');
    const confirmDb=new DatabaseSync(f.sqlite,{readOnly:true});
    try{assert.equal(confirmDb.prepare('SELECT COUNT(*) AS total FROM system_snapshots').get().total,1);}
    finally{confirmDb.close();}
  }finally{f.cleanup();}
});

test('lab preparation cannot run without matching explicit confirmation or clean pinned SHA',()=>{
  const f=fixture();
  try{
    for(const override of [
      {ARL_OPERATOR_LAB_ONLY:'0'},
      {ARL_LAB_PREPARE_CONFIRMATION:'PREPARE LAB bad'},
      {ARL_EXPECTED_TARGET_SHA:'0'.repeat(40)},
      {NODE_ENV:'development',DATABASE_PATH:'',ARL_OPERATOR_LAB_DATABASE_URL:''},
      {NODE_ENV:'development',DATABASE_PATH:'',
       ARL_OPERATOR_LAB_DATABASE_URL:'postgresql://private:secret@example.org/arl_operator_lab'},
      {NODE_ENV:'development',DATABASE_PATH:'',
       ARL_OPERATOR_LAB_DATABASE_URL:'postgresql://private:secret@127.0.0.1/arl_production'}
    ]){
      const result=command(['--lab-prepare',f.target],{...f.env,...override});
      assert.equal(result.status,2,JSON.stringify(override));
      assert.equal(result.stdout.trim(),'');
      assert.doesNotMatch(result.stderr,/private:secret|postgresql:\/\//);
    }
    assert.equal(fs.existsSync(f.sqlite),false);
    fs.appendFileSync(path.join(f.target,'README.md'),'DIRTY\n');
    const dirty=command(['--lab-prepare',f.target],f.env);
    assert.equal(dirty.status,2);
    assert.equal(dirty.stdout.trim(),'');
    assert.equal(fs.existsSync(f.sqlite),false);
  }finally{f.cleanup();}
});

test('lab-only preparation rejects additional CLI arguments',()=>{
  const f=fixture();
  try{
    const response=command(['--lab-prepare',f.target,'Run the bounded test'],f.env);
    assert.equal(response.status,2);
    assert.equal(response.stdout.trim(),'');
    assert.equal(fs.existsSync(f.sqlite),false);
  }finally{f.cleanup();}
});
