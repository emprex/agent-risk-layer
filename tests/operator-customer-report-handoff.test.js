import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import test from 'node:test';
import {buildCustomerAssessmentDeliverable,writeCustomerAssessmentDeliverable} from '../src/agent/customer-assessment-deliverable.mjs';
import {inspectExistingCustomerBundle} from '../bin/arl-review-customer-report.mjs';

function fixture(fn) {
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'arl-real-report-check-'));
  try{
    const report={
      schema:'arl.customer-assessment-report.v1',available:true,projection:'read_only',
      assessment:{projectName:'SYNTHETIC pilot',targetRevision:'a'.repeat(40),
        systemSnapshotVersion:'test-snapshot',controlProfileVersion:'ARL-RKA-1.2.0',
        mappedControlCount:1,scopeStatement:'Synthetic staging test',scopeExclusions:['Production']},
      controls:[{controlId:'ARL-KB-032',title:'Synthetic security control',
        evidence:{currentItems:1,verifiedActiveItems:1,verifiedActiveIds:['ev_synthetic_01']},
        findings:[],tests:[{testExecutionId:'test_synthetic_01',result:'inconclusive'}],
        retests:[],applicability:{status:'applicable'},authorityState:{currentStage:'review'}}],
      summary:{missingEvidence:['Synthetic independent side effect proof missing']},
      readiness:{status:'HOLD',humanReviewRequired:true,finalDecisionAuthority:'human',
        finalDecisionRecorded:false,conversationLayerDecisionWritten:false},
      limitations:['Synthetic fixtures cannot establish a live security finding.'],
      securityStateChanged:false,deploymentDecisionWritten:false,humanReviewRequired:true,
      disclaimer:'SYNTHETIC ONLY'
    };
    const bundle=buildCustomerAssessmentDeliverable(report);
    const written=writeCustomerAssessmentDeliverable({deliverable:bundle,outputDirectory:root});
    const manifest=written.files.find(f=>f.name.endsWith('.manifest.json')).path;
    return fn({root,manifest,written,report});
  }finally{fs.rmSync(root,{recursive:true,force:true});}
}

test('real exported bundle -> operator reviewer: facts and missing evidence, no approval',()=>fixture(({manifest})=>{
  const r=inspectExistingCustomerBundle(manifest);
  assert.equal(r.integrity,'consistent_only');
  assert.equal(r.controlsMapped,1);
  assert.equal(r.evidenceItems,1);
  assert.equal(r.testAndRetestRecords,1);
  assert.equal(r.customerReleaseApproved,false);
  assert.equal(r.certified,false);
  assert.equal(r.unresolvedEvidence,1);
  assert.ok(r.reviewIssues.some(x=>x.toLowerCase().includes('missing-evidence')));
  const proc=spawnSync(process.execPath,['bin/arl-review-customer-report.mjs',manifest],{
    cwd:path.resolve(import.meta.dirname,'..'),encoding:'utf8',timeout:10000
  });
  assert.equal(proc.status,0,proc.stderr);
  assert.match(proc.stdout,/NOT APPROVED FOR CUSTOMER RELEASE/);
  assert.doesNotMatch(proc.stdout,/SYNTHETIC pilot/);
}));

test('tampered exact report bundle cannot pass operator review',()=>fixture(({manifest,written})=>{
  const md=written.files.find(f=>f.name.endsWith('.md')).path;
  fs.appendFileSync(md,'unauthorised appended text');
  assert.throws(()=>inspectExistingCustomerBundle(manifest),/integrity check failed/);
  const proc=spawnSync(process.execPath,['bin/arl-review-customer-report.mjs',manifest],{
    cwd:path.resolve(import.meta.dirname,'..'),encoding:'utf8',timeout:10000
  });
  assert.notEqual(proc.status,0);
  assert.doesNotMatch(proc.stdout,/Integrity: consistent_only/);
}));

test('operator review never confuses absent test evidence with a PASS',()=>fixture(({manifest})=>{
  const r=inspectExistingCustomerBundle(manifest);
  assert.equal(r.securityVerdictInferred,false);
  assert.equal(r.status,'INTERNAL_DRAFT_HUMAN_REVIEW_REQUIRED');
}));
