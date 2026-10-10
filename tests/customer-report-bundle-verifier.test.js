import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

import { CUSTOMER_ASSESSMENT_REPORT_SCHEMA }
  from '../src/agent/customer-assessment-report.mjs';
import {
  buildCustomerAssessmentDeliverable,
  writeCustomerAssessmentDeliverable
} from '../src/agent/customer-assessment-deliverable.mjs';
import { verifyCustomerReportBundle }
  from '../src/agent/customer-report-bundle-verifier.mjs';

const rev='a'.repeat(40);
const template={
  schema:CUSTOMER_ASSESSMENT_REPORT_SCHEMA,
  available:true,
  projection:'read_only',
  assessment:{
    projectName:'Synthetic client acceptance',
    targetRevision:rev,
    systemSnapshotVersion:'synthetic-snapshot-v1',
    controlProfileVersion:'ARL-RKA-1.2.0',
    mappedControlCount:0
  },
  controls:[],
  readiness:{
    status:'HOLD',
    rationale:'Unreviewed synthetic evidence blocks release.',
    humanReviewRequired:true,
    finalDecisionAuthority:'human',
    finalDecisionRecorded:false,
    conversationLayerDecisionWritten:false
  },
  securityStateChanged:false,
  deploymentDecisionWritten:false,
  humanReviewRequired:true,
  disclaimer:'SYNTHETIC ONLY'
};

function fixture(action) {
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'arl-bundle-verifier-'));
  try {
    const bundle=buildCustomerAssessmentDeliverable(structuredClone(template));
    const written=writeCustomerAssessmentDeliverable({deliverable:bundle,outputDirectory:root});
    const manifest=written.files.find(f=>f.name.endsWith('.manifest.json')).path;
    return action({root,bundle,written,manifest});
  } finally {
    fs.rmSync(root,{force:true,recursive:true});
  }
}

test('immutable private customer report passes exact three-file integrity check without security claim',()=>fixture(({bundle,written,manifest})=>{
  const result=verifyCustomerReportBundle(manifest);
  assert.equal(result.integrity,'consistent_only');
  assert.equal(result.authenticity,'not_verified_no_signature');
  assert.equal(result.reportSecurityVerdict,'not_assessed');
  assert.equal(result.bundleSha256,bundle.bundleSha256);
  assert.equal(result.targetRevision,rev);
  assert.equal(result.readinessStatus,'HOLD');
  assert.equal(result.filesChecked,3);
  assert.equal(result.humanReviewRequired,true);
  assert.equal(result.securityStateChanged,false);
  assert.equal(result.deploymentDecisionWritten,false);
  assert.equal(written.createdFiles,3);
}));

test('independent offline CLI checks the same private manifest without a DB or network',()=>fixture(({manifest})=>{
  const command=spawnSync(process.execPath,
    ['scripts/verify-customer-report-bundle.mjs',manifest], {
      cwd:new URL('../',import.meta.url).pathname,
      env:{...process.env,DATABASE_URL:'',NODE_ENV:'development'},
      encoding:'utf8',timeout:10_000
    });
  assert.equal(command.status,0,command.stderr);
  const result=JSON.parse(command.stdout);
  assert.equal(result.integrity,'consistent_only');
  assert.equal(result.readinessStatus,'HOLD');
  assert.equal(result.filesChecked,3);
  assert.equal(result.deploymentDecisionWritten,false);
  assert.doesNotMatch(command.stdout,/api key|passphrase|credential/i);
}));

test('tampering with markdown, JSON or manifest independently fails closed',()=>fixture(({written,manifest})=>{
  for(const file of written.files) {
    const original=fs.readFileSync(file.path);
    fs.appendFileSync(file.path,'\nSYNTHETIC-TAMPER');
    assert.throws(()=>verifyCustomerReportBundle(manifest),
      /integrity check failed|malformed manifest/i,file.name);
    fs.writeFileSync(file.path,original);
  }
  assert.equal(verifyCustomerReportBundle(manifest).filesChecked,3);
}));

test('foreign manifest mixed with a same-target later report cannot be accepted',()=>fixture(({root,manifest})=>{
  const newer=structuredClone(template);
  newer.readiness.rationale='New synthetic review, still HOLD.';
  const second=buildCustomerAssessmentDeliverable(newer);
  const produced=writeCustomerAssessmentDeliverable({deliverable:second,outputDirectory:root});
  const latest=produced.files.find(f=>f.name.endsWith('.manifest.json')).path;
  assert.notEqual(latest,manifest);
  assert.equal(verifyCustomerReportBundle(latest).bundleSha256,second.bundleSha256);
  const original=fs.readFileSync(latest);
  fs.writeFileSync(latest,fs.readFileSync(manifest));
  assert.throws(()=>verifyCustomerReportBundle(latest),/integrity check failed/);
  fs.writeFileSync(latest,original);
  assert.equal(verifyCustomerReportBundle(latest).filesChecked,3);
}));

test('rejects symlinked, hardlinked, publicly readable or replaced report files',()=>fixture(({root,written,manifest})=>{
  const first=written.files.find(f=>f.name.endsWith('.md')).path;
  const original=fs.readFileSync(first);
  fs.chmodSync(first,0o644);
  assert.throws(()=>verifyCustomerReportBundle(manifest),/non-private/);
  fs.chmodSync(first,0o600);
  const other=path.join(root,'synthetic-other');
  fs.linkSync(first,other);
  assert.throws(()=>verifyCustomerReportBundle(manifest),/linked/);
  fs.rmSync(other);
  fs.rmSync(first);
  fs.symlinkSync(path.join(root,'missing-file'),first);
  assert.throws(()=>verifyCustomerReportBundle(manifest),/non-private|linked|non-regular/);
  fs.rmSync(first);
  fs.writeFileSync(first,original,{mode:0o600});
  assert.equal(verifyCustomerReportBundle(manifest).filesChecked,3);
}));

test('rejects public directories, linked parents and manifest path tricks',()=>fixture(({root,manifest})=>{
  fs.chmodSync(root,0o755);
  assert.throws(()=>verifyCustomerReportBundle(manifest),/not private/);
  fs.chmodSync(root,0o700);
  const parent=fs.mkdtempSync(path.join(os.tmpdir(),'arl-report-linked-'));
  try {
    const alias=path.join(parent,'alias');
    fs.symlinkSync(root,alias);
    assert.throws(()=>verifyCustomerReportBundle(path.join(alias,path.basename(manifest))),
      /symlinked directory/);
  } finally {
    fs.rmSync(parent,{force:true,recursive:true});
  }
  assert.throws(()=>verifyCustomerReportBundle(path.parse(root).root+'/wrong.manifest.json'),
    /filesystem root/);
  assert.equal(verifyCustomerReportBundle(manifest).filesChecked,3);
}));

test('bad report authority fields cannot be treated as consistency verified',()=>fixture(({written,manifest})=>{
  const json=written.files.find(f=>f.name.endsWith('.json')&&!f.name.endsWith('.manifest.json')).path;
  const report=JSON.parse(fs.readFileSync(json,'utf8'));
  report.deploymentDecisionWritten=true;
  fs.writeFileSync(json,JSON.stringify(report,null,2)+'\n');
  assert.throws(()=>verifyCustomerReportBundle(manifest),/integrity check failed/);
}));

test('nonexistent, missing, blank and extra CLI arguments are nonzero without leak',()=>{
  const run=args=>spawnSync(process.execPath,
    ['scripts/verify-customer-report-bundle.mjs',...args],{
      cwd:new URL('../',import.meta.url).pathname,
      env:{...process.env,DATABASE_URL:'',NODE_ENV:'development'},
      encoding:'utf8',timeout:10_000
    });
  for(const args of [[],[''],['missing.manifest.json','extra']]){
    const r=run(args);
    assert.notEqual(r.status,0);
    assert.doesNotMatch(r.stdout,/consistent_only/);
  }
});
