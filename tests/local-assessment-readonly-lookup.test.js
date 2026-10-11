import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));

test('existing-assessment lookup returns null without creating identity, project or assessment',()=>{
  const tmp=fs.mkdtempSync(path.join(os.tmpdir(),'arl-readonly-assessment-'));
  const target=path.join(tmp,'target');
  fs.mkdirSync(target);
  try {
    const code = `
      import assert from 'node:assert/strict';
      import { enableLocalCliMode } from './src/agent/local-cli-mode.mjs';
      enableLocalCliMode(process.env);
      const { db, initialiseDatabase }=await import('./src/db.js');
      const { findExistingLocalAssessmentContext }=await import('./src/agent/local-assessment-context.mjs');
      await initialiseDatabase();
      const count=async table=>Number((await db.prepare('SELECT COUNT(*) AS n FROM '+table).get()).n);
      const before=await Promise.all(['users','security_projects','assessments'].map(count));
      const result=await findExistingLocalAssessmentContext(process.env.ARL_LOOKUP_TARGET);
      const after=await Promise.all(['users','security_projects','agent_assessments'].map(count));
      assert.equal(result,null);
      assert.deepEqual(after,before);
      console.log('READ_ONLY_LOOKUP_OK');
    `;
    const result=spawnSync(process.execPath,['--input-type=module','--eval',code],{
      cwd:root,encoding:'utf8',timeout:90000,
      env:{...process.env,NODE_ENV:'test',PRODUCT_STAGE:'development',
        DATABASE_URL:'',DATABASE_PATH:path.join(tmp,'test.sqlite'),
        ARL_LOOKUP_TARGET:target,ARL_LOCAL_MODE:'1'}
    });
    assert.equal(result.status,0,`stderr: ${result.stderr}\nstdout: ${result.stdout}`);
    assert.match(result.stdout,/READ_ONLY_LOOKUP_OK/);
  } finally { fs.rmSync(tmp,{recursive:true,force:true}); }
});
