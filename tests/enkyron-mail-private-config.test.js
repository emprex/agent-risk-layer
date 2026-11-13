import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {loadPrivateResendConfig} from '../desktop/enkyron-mail-private-config.mjs';

const fixture=()=>JSON.stringify({
  version:1,api_key:'re_'+'A'.repeat(36),mailboxes:{
    direction:'11111111-1111-4111-8111-111111111111',
    support:'22222222-2222-4222-8222-222222222222',
  },
});
test('Owner Resend config is local 0600 and not exposed through UI',async()=>{
  const folder=await fs.mkdtemp(path.join(os.tmpdir(),'enkyron-mail-'));
  const file=path.join(folder,'inbox-access-v1.json');
  try{
    await fs.chmod(folder,0o700);
    await fs.writeFile(file,fixture(),{mode:0o600,flag:'wx'});
    const config=await loadPrivateResendConfig(file);
    assert.deepEqual(Object.keys(config).sort(),['credentialProvider','mailboxes']);
    assert.equal(config.mailboxes.direction,'11111111-1111-4111-8111-111111111111');
    assert.equal(await config.credentialProvider(),'re_'+'A'.repeat(36));
    await fs.chmod(file,0o644);
    await assert.rejects(loadPrivateResendConfig(file),/not configured/);
    await fs.chmod(file,0o600);
    await fs.chmod(folder,0o755);
    await assert.rejects(loadPrivateResendConfig(file),/not configured/);
  }finally{await fs.rm(folder,{recursive:true,force:true});}
});
test('Owner Resend config rejects symlinks, duplicate IDs, malformed keys and paths',async()=>{
  const folder=await fs.mkdtemp(path.join(os.tmpdir(),'enkyron-mail-'));
  const file=path.join(folder,'inbox-access-v1.json');
  const link=path.join(folder,'link.json');
  try{
    await fs.chmod(folder,0o700);
    const bad=JSON.parse(fixture());
    bad.mailboxes.support=bad.mailboxes.direction;
    await fs.writeFile(file,JSON.stringify(bad),{mode:0o600,flag:'wx'});
    await assert.rejects(loadPrivateResendConfig(file),/not configured/);
    await fs.writeFile(file,fixture());
    await fs.symlink(file,link);
    await assert.rejects(loadPrivateResendConfig(link),/not configured/);
    await assert.rejects(loadPrivateResendConfig('../relative.json'),/not configured/);
    bad.mailboxes.support='22222222-2222-4222-8222-222222222222';
    bad.api_key='not-a-resend-key';
    await fs.writeFile(file,JSON.stringify(bad));
    await assert.rejects(loadPrivateResendConfig(file),/not configured/);
  }finally{await fs.rm(folder,{recursive:true,force:true});}
});
