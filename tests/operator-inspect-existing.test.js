import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
test('inspect-existing does not bootstrap a missing frozen assessment',()=>{
  const base=fs.mkdtempSync(path.join(os.tmpdir(),'arl-inspect-existing-'));
  const target=path.join(base,'target');
  const database=path.join(base,'test.sqlite');
  fs.mkdirSync(target);
  const git=args=>spawnSync('git',args,{cwd:target,encoding:'utf8'});
  const env={...process.env,NODE_ENV:'test',PRODUCT_STAGE:'development',
    DATABASE_URL:'',DATABASE_PATH:database,
    // Never bind this synthetic fixture to the operator's real frozen target.
    ARL_EXPECTED_TARGET_SHA:''};
  try {
    for(const args of [
      ['init','-q'],['config','user.name','ARL Test'],['config','user.email','arl@example.test'],
      ['config','commit.gpgsign','false']
    ]) assert.equal(git(args).status,0);
    fs.writeFileSync(path.join(target,'README.md'),'synthetic target\n');
    assert.equal(git(['add','README.md']).status,0);
    assert.equal(git(['commit','-q','-m','fixture']).status,0);
    const setup=spawnSync(process.execPath,['--input-type=module','--eval',
      "const {initialiseDatabase}=await import('./src/db.js'); await initialiseDatabase();"
    ],{cwd:root,env,encoding:'utf8'});
    assert.equal(setup.status,0,setup.stderr);
    const attempt=spawnSync(process.execPath,['src/agent/arl-inspect-existing-assessment.mjs',target],
      {cwd:root,env,encoding:'utf8'});
    assert.equal(attempt.status,0,attempt.stderr);
    assert.match(attempt.stdout,/NO EXISTING LOCAL ASSESSMENT/);
    const count=spawnSync(process.execPath,['--input-type=module','--eval',
      "const {db}=await import('./src/db.js'); const tables=['users','security_projects','assessments']; console.log((await Promise.all(tables.map(t=>db.prepare('SELECT COUNT(*) AS n FROM '+t).get()))).map(x=>Number(x.n)).join(','));"
    ],{cwd:root,env,encoding:'utf8'});
    assert.equal(count.status,0,count.stderr);
    assert.equal(count.stdout.trim(),'0,0,0');
    const mismatch=spawnSync(process.execPath,['src/agent/arl-inspect-existing-assessment.mjs',target],
      {cwd:root,env:{...env,ARL_EXPECTED_TARGET_SHA:'0'.repeat(40)},encoding:'utf8'});
    assert.equal(mismatch.status,2);
    assert.match(mismatch.stderr,/SHA does not match/);
  } finally { fs.rmSync(base,{recursive:true,force:true}); }
});
