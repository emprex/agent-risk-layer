import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { EventEmitter } from 'node:events';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import {
  validateOperatorDashboardArtifact,
  openOperatorDashboardInBrowser
} from '../src/agent/operator-dashboard-browser.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const revision = 'b3116fcfcec3bf6967773c3e9587c502b1fed5e5';

function fixture() {
  const parent = fs.mkdtempSync(path.join(os.tmpdir(), 'arl-browser-'));
  const outputDirectory = path.join(parent, 'private');
  fs.mkdirSync(outputDirectory, {mode:0o700});
  const content = '<!doctype html><title>Local ARL Review</title>';
  const sha256 = crypto.createHash('sha256').update(content).digest('hex');
  const filePath = path.join(outputDirectory, 'ARL-operator-review-' + sha256.slice(0,16) + '.html');
  fs.writeFileSync(filePath, content, {mode:0o600, flag:'wx'});
  const metadata = {
    schema:'arl.agent.offline-operator-review-dashboard.v1',
    systemSnapshotId:'synthetic-test-snapshot',
    targetRevision:revision,
    assessedControls:98,
    excludedControls:10,
    filePath, sha256,
    fileStatus:'created'
  };
  return {parent, outputDirectory, filePath, metadata};
}
function clean(f) { fs.rmSync(f.parent,{force:true,recursive:true}); }

test('operator browser accepts only exact private digest-bound output', () => {
  const f=fixture();
  try {
    assert.equal(validateOperatorDashboardArtifact(f.metadata,f.outputDirectory),f.filePath);
    fs.appendFileSync(f.filePath,'<div>changed</div>');
    assert.throws(()=>validateOperatorDashboardArtifact(f.metadata,f.outputDirectory),/integrity mismatch/);
  } finally {clean(f);}
});

test('operator browser refuses forged path, foreign directory and incorrect content prefix',()=>{
  const f=fixture();
  try {
    assert.throws(()=>validateOperatorDashboardArtifact({...f.metadata,filePath:path.join(f.parent,'wrong.html')},f.outputDirectory),/path or digest prefix/);
    assert.throws(()=>validateOperatorDashboardArtifact({...f.metadata,sha256:'f'.repeat(64)},f.outputDirectory),/path or digest prefix/);
    assert.throws(()=>validateOperatorDashboardArtifact({...f.metadata,fileStatus:'unknown'},f.outputDirectory),/unverified/);
    assert.throws(()=>validateOperatorDashboardArtifact({...f.metadata,targetRevision:'bad'},f.outputDirectory),/unverified/);
  } finally {clean(f);}
});

test('operator browser refuses public files or symlinked directory ancestor',()=>{
  const f=fixture();
  try {
    fs.chmodSync(f.filePath,0o644);
    assert.throws(()=>validateOperatorDashboardArtifact(f.metadata,f.outputDirectory),/bounded private regular file/);
    fs.chmodSync(f.filePath,0o600);
    fs.chmodSync(f.outputDirectory,0o755);
    assert.throws(()=>validateOperatorDashboardArtifact(f.metadata,f.outputDirectory),/private and non-symlinked/);
    fs.chmodSync(f.outputDirectory,0o700);
    const link = path.join(f.parent, 'link');
    fs.symlinkSync(f.outputDirectory,link);
    assert.throws(()=>validateOperatorDashboardArtifact({
      ...f.metadata,filePath:path.join(link,path.basename(f.filePath))
    },link),/symlinked ancestor/);
  } finally {clean(f);}
});

test('operator browser launches only validated HTML with an argument array, never a shell',async()=>{
  const f=fixture();
  try {
    const calls=[];
    const launcher=(command,args,options)=>{
      calls.push({command,args,options});
      const child=new EventEmitter();
      child.unref=()=>{calls.push({unref:true});};
      queueMicrotask(()=>child.emit('spawn'));
      return child;
    };
    const output=await openOperatorDashboardInBrowser({
      metadata:f.metadata,outputDirectory:f.outputDirectory,launcher
    });
    assert.equal(output.filePath,f.filePath);
    if (process.platform==='linux') {
      assert.equal(output.requested,true);
      assert.equal(calls[0].command,'xdg-open');
      assert.deepEqual(calls[0].args,[f.filePath]);
      assert.equal(calls[0].options.shell,false);
      assert.equal(calls[0].options.detached,true);
    } else {
      assert.equal(output.requested,false);
    }
  } finally {clean(f);}
});

test('missing graphical opener leaves a manually openable file and never claims success',async()=>{
  const f=fixture();
  try {
    const launcher=()=>{
      const child=new EventEmitter();
      queueMicrotask(()=>child.emit('error',new Error('xdg-open unavailable')));
      return child;
    };
    const output=await openOperatorDashboardInBrowser({
      metadata:f.metadata,outputDirectory:f.outputDirectory,launcher
    });
    assert.equal(output.requested,false);
    assert.equal(output.filePath,f.filePath);
  } finally {clean(f);}
});

test('one-command entry point fixes export request and refuses user-supplied substitute commands',()=>{
  const pkg=JSON.parse(fs.readFileSync(path.join(root,'package.json'),'utf8'));
  assert.match(pkg.scripts['operator:open'],/ARL_OPERATOR_OPEN_DASHBOARD=1/);
  assert.match(pkg.scripts['operator:open'],/arl-local-assessment-runner\.mjs/);
  const child=spawnSync(process.execPath,[
    'src/agent/arl-local-assessment-runner.mjs',
    '/missing-synthetic-target',
    'Run bounded test'
  ],{
    cwd:root,
    env:{...process.env,ARL_OPERATOR_OPEN_DASHBOARD:'1'},
    encoding:'utf8'
  });
  assert.equal(child.status,2);
  assert.match(child.stderr,/Usage: npm run operator:open/);
  assert.doesNotMatch(child.stderr,/bound.*test.*authoris/i);
});
