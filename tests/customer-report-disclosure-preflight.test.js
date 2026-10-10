import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawnSync} from 'node:child_process';

import {prepareCustomerReportDisclosurePreflight}
  from '../src/agent/customer-report-disclosure-preflight.mjs';
import {verifyCustomerReportBundle}
  from '../src/agent/customer-report-bundle-verifier.mjs';
import {buildCustomerAssessmentDeliverable,writeCustomerAssessmentDeliverable}
  from '../src/agent/customer-assessment-deliverable.mjs';
import {CUSTOMER_ASSESSMENT_REPORT_SCHEMA}
  from '../src/agent/customer-assessment-report.mjs';

const REVISION='a'.repeat(40);
const SECRETS=Object.freeze([
  'Authorization: Bearer synthetic-token-DO-NOT-SEND-123',
  'client_secret=syntheticsecretDO-NOT-SEND-123',
  '-----BEGIN PRIVATE KEY-----',
  'person-private@example.invalid',
  'https://private.example.invalid/callback?access_token=hidden'
]);

function reportFixture(){
  return {
    schema:CUSTOMER_ASSESSMENT_REPORT_SCHEMA,
    available:true,
    projection:'read_only',
    assessment:{
      projectName:'Synthetic client only',
      targetRevision:REVISION,
      systemSnapshotVersion:'synthetic-snapshot-v1',
      controlProfileVersion:'ARL-RKA-1.2.0',
      scopeStatement:'Authorised synthetic scope only',
      mappedControlCount:0
    },
    controls:[],
    summary:{missingEvidence:[]},
    readiness:{
      status:'HOLD',
      rationale:'Human approval and actual evidence remain outstanding.',
      humanReviewRequired:true,
      finalDecisionAuthority:'human',
      finalDecisionRecorded:false,
      conversationLayerDecisionWritten:false
    },
    limitations:[],
    securityStateChanged:false,
    deploymentDecisionWritten:false,
    humanReviewRequired:true,
    disclaimer:'SYNTHETIC ONLY — never a customer security conclusion.'
  };
}

function withWrittenReport(input,callback){
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'arl-disclosure-preview-'));
  try{
    const bundle=buildCustomerAssessmentDeliverable(input);
    const result=writeCustomerAssessmentDeliverable({deliverable:bundle,outputDirectory:root});
    const manifest=result.files.find(x=>x.name.endsWith('.manifest.json')).path;
    return callback({root,bundle,manifest,result});
  }finally{
    fs.rmSync(root,{recursive:true,force:true});
  }
}

test('all disclosure preflight indicators are bounded and never disclose raw suspicious strings',()=>{
  const report=reportFixture();
  report.assessment.scopeExclusions=SECRETS[0];
  report.readiness.rationale=SECRETS[1];
  report.readiness.reasons=[SECRETS[2]];
  report.summary.missingEvidence=[SECRETS[3]];
  report.statement=SECRETS[4];
  const before=structuredClone(report);
  const review=prepareCustomerReportDisclosurePreflight(report);
  assert.equal(review.status,'HUMAN_DISCLOSURE_REVIEW_REQUIRED');
  assert.equal(review.automaticDisclosureApproval,false);
  assert.equal(review.deploymentDecisionWritten,false);
  assert.equal(review.reportContentChanged,false);
  assert.equal(review.flaggedFieldCount,5);
  assert.equal(review.flaggedFields.length,5);
  assert.equal(review.inspectionIncomplete,false);
  assert.equal(review.indicatorCounts.private_key_marker,1);
  assert.equal(review.indicatorCounts.bearer_token_marker,1);
  assert.equal(review.indicatorCounts.credential_assignment,1);
  assert.equal(review.indicatorCounts.contact_email_address,1);
  assert.equal(review.indicatorCounts.url_with_query_string,1);
  for(const secret of SECRETS) assert.equal(JSON.stringify(review).includes(secret),false);
  assert.deepEqual(report,before);
});

test('clean heuristic scan never grants transmission clearance or changes HOLD',()=>{
  const review=prepareCustomerReportDisclosurePreflight(reportFixture());
  assert.equal(review.flaggedFieldCount,0);
  assert.equal(review.inspectionIncomplete,false);
  assert.equal(review.status,'HUMAN_DISCLOSURE_REVIEW_REQUIRED');
  assert.equal(review.automaticDisclosureApproval,false);
  assert.equal(review.securityFindingAuthority,false);
  assert.match(review.limitations,/No signature/);
  assert.ok(review.humanChecklist.some(x=>/recipient/.test(x)));
});

test('adversarial JSON field name and oversized text never leak or assert full coverage',()=>{
  const report=reportFixture();
  const injection='Authorization: Bearer syntheticfield-secret';
  report[injection]=SECRETS[0];
  report.statement='x'.repeat(20_000)+SECRETS[1];
  const review=prepareCustomerReportDisclosurePreflight(report);
  assert.equal(review.flaggedFields.some(x=>x.field.includes(injection)),false);
  assert.equal(JSON.stringify(review).includes(SECRETS[0]),false);
  assert.equal(review.truncatedTextFields,1);
  assert.equal(review.inspectionIncomplete,true);
  assert.ok(review.flaggedFields.some(x=>x.field==='report.[other]'));
});

test('bounded traversal is marked incomplete rather than falsely clearing excessive arrays',()=>{
  const report=reportFixture();
  report.limitations=Array.from({length:22_000},(_,i)=>'safe synthetic '+i);
  const review=prepareCustomerReportDisclosurePreflight(report);
  assert.equal(review.inspectionIncomplete,true);
  assert.ok(review.visitedNodes<=20_000);
  assert.equal(review.status,'HUMAN_DISCLOSURE_REVIEW_REQUIRED');
});

test('private manifest disclosure CLI verifies bundle first and returns no raw content',()=> {
  const report=reportFixture();
  report.readiness.rationale=SECRETS[0];
  report.assessment.scopeExclusions=SECRETS[3];
  withWrittenReport(report,({manifest,bundle})=>{
    const command=spawnSync(process.execPath,
      ['scripts/review-customer-report-disclosure.mjs',manifest],{
        cwd:new URL('../',import.meta.url).pathname,
        env:{...process.env,DATABASE_URL:'',NODE_ENV:'development'},
        encoding:'utf8',timeout:10_000
      });
    assert.equal(command.status,0,command.stderr);
    const result=JSON.parse(command.stdout);
    assert.equal(result.integrity,'consistent_only');
    assert.equal(result.bundleSha256,bundle.bundleSha256);
    assert.equal(result.disclosurePreflight.flaggedFieldCount,2);
    assert.equal(result.disclosurePreflight.automaticDisclosureApproval,false);
    assert.equal(result.disclosurePreflight.status,'HUMAN_DISCLOSURE_REVIEW_REQUIRED');
    for(const secret of SECRETS)assert.equal(command.stdout.includes(secret),false);
    assert.equal(verifyCustomerReportBundle(manifest).disclosurePreflight,undefined);
    assert.equal(verifyCustomerReportBundle(manifest,{disclosurePreflight:true})
      .disclosurePreflight.flaggedFieldCount,2);
  });
});

test('a modified JSON file aborts disclosure CLI without printing any sensitive text',()=>{
  const report=reportFixture();
  report.readiness.rationale=SECRETS[0];
  withWrittenReport(report,({manifest,result})=>{
    const json=result.files.find(x=>x.name.endsWith('.json')&&!x.name.endsWith('.manifest.json'));
    fs.appendFileSync(json.path,'SYNTHETIC-TAMPER');
    const command=spawnSync(process.execPath,
      ['scripts/review-customer-report-disclosure.mjs',manifest],{
        cwd:new URL('../',import.meta.url).pathname,
        env:{...process.env,DATABASE_URL:'',NODE_ENV:'development'},
        encoding:'utf8',timeout:10_000
      });
    assert.notEqual(command.status,0);
    assert.match(command.stderr,/private bundle not consistently verified/);
    assert.equal(command.stdout.length,0);
    assert.equal(command.stderr.includes(SECRETS[0]),false);
  });
});

test('non-authoritative input cannot be presented as a disclosure preflight',()=>{
  for(const bad of [null,{}, {...reportFixture(), projection:'authoritative'},
    {...reportFixture(),deploymentDecisionWritten:true}]){
    assert.throws(()=>prepareCustomerReportDisclosurePreflight(bad),
      /verified read-only customer report/);
  }
});
