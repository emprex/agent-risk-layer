import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { buildControlWorkQueue } from '../src/agent/control-work-queue.mjs';
import { buildAssessmentEvidenceBatchIndex } from '../src/agent/assessment-evidence-batch-index.mjs';
import { buildAssessmentReviewDossiers } from '../src/agent/assessment-review-dossiers.mjs';
import {
  buildOfflineOperatorReviewDashboard,
  renderOfflineOperatorReviewHtml,
  writeOfflineOperatorReviewDashboard
} from '../src/agent/offline-operator-review-dashboard.mjs';

const rev='b3116fcfcec3bf6967773c3e9587c502b1fed5e5';
const items=[{
  controlId:'ARL-KB-006',chainStatus:'finding_open',
  currentStage:'remediation',deploymentImpact:'blocker'
},{
  controlId:'ARL-KB-007',currentStage:'test',
  chainStatus:'test_inconclusive',deploymentImpact:'hold'
},{
  controlId:'ARL-KB-008',currentStage:'test',
  chainStatus:'test_inconclusive',deploymentImpact:'hold'
},{
  controlId:'ARL-KB-001',currentStage:'deployment_decision',
  chainStatus:'controlled_with_evidence'
}];
const page={systemSnapshot:{id:'snapshot'},total:4,items,hasMore:false};
const queue=buildControlWorkQueue([page]);
const index=buildAssessmentEvidenceBatchIndex(queue);
const details=id=>({
  control:{id,title:id==='ARL-KB-007'?'Acme <script>alert(1)</script>':'Agent inventory'},
  systemSnapshot:{
    id:'snapshot',
    versionIdentifier:rev,
    assessmentConfiguration:{
      targetBinding:{schema:'arl.target-binding.v1',source:'git',revision:rev}
    }
  },
  testDefinition:{
    id:'ARL-CHK-'+id.slice(-3),
    digest:'digest-'+id,
    objective:'Check agent <script>evil()</script> inventory.',
    method:'Read frozen records.',
    requiredEvidence:['Reviewer identity, role, timestamp and evidence digest'],
    passCondition:'Human acceptance required.',
    failCondition:'Missing evidence cannot be accepted.'
  },
  tests:[{
    id:'ctx-'+id,controlId:id,systemSnapshotId:'snapshot',
    checkId:'ARL-CHK-'+id.slice(-3),
    checkDigest:'digest-'+id,result:'inconclusive',
    executionKind:'initial',executionMethod:'static'
  }],
  evidence:[{
    id:'cei-'+id,controlId:id,systemSnapshotId:'snapshot',
    sourceType:'arl_frozen_source_evidence_collection',
    evidenceClass:'observed',verificationState:'unverified',
    retentionStatus:'active',testExecutionId:'ctx-'+id
  }]
});
function dashboard(){
  const batch=index.batches[0];
  const review=buildAssessmentReviewDossiers({
    queue,controlIds:batch.controlIds,
    details:batch.controlIds.map(details)
  });
  return buildOfflineOperatorReviewDashboard(index,[review],rev);
}

test('real 4-control scenario renders 2 review controls and explicitly excludes held findings',()=>{
  const report=dashboard();
  assert.equal(report.assessedControls,2);
  assert.equal(report.excludedControls,2);
  assert.ok(report.controls.every(c => c.outcome==='operator_review_required'));
  assert.equal(report.testsExecuted,0);
  assert.equal(report.evidencePersisted,0);
  assert.equal(report.evidenceAutomaticallyVerified,0);
  assert.equal(report.securityStateChanged,false);
  assert.equal(report.deploymentDecisionWritten,false);
  const html=renderOfflineOperatorReviewHtml(report);
  assert.match(html,/<!doctype html>/);
  assert.match(html,/Deployment HOLD/);
  assert.match(html,/ARL-KB-007/);
  assert.doesNotMatch(html,/id="ARL-KB-006"/);
  assert.match(html,/&lt;script&gt;alert\(1\)&lt;\/script&gt;/);
  assert.doesNotMatch(html,/<script>|onerror=/);
  assert.match(html,/default-src &#39;none&#39;/);
  assert.match(html,/No PASS\/FAIL inferred/);
  assert.doesNotMatch(html,/https?:\/\//);
});

test('offline output is immutable, non-executable, private by filesystem permissions',()=>{
  const directory=fs.mkdtempSync(path.join(os.tmpdir(),'arl-offline-review-'));
  try {
    const report=dashboard();
    const first=writeOfflineOperatorReviewDashboard({dashboard:report,outputDirectory:directory});
    const second=writeOfflineOperatorReviewDashboard({dashboard:report,outputDirectory:directory});
    assert.equal(first.status,'created');
    assert.equal(second.status,'unchanged');
    assert.equal(first.sha256,second.sha256);
    assert.equal(fs.statSync(first.path).mode & 0o777,0o600);
    assert.ok(first.path.startsWith(directory));
    assert.match(fs.readFileSync(first.path,'utf8'),/human review required/i);
    assert.equal(first.securityStateChanged,false);
    assert.equal(first.deploymentDecisionWritten,false);
  } finally {
    fs.rmSync(directory,{recursive:true,force:true});
  }
});

test('rejects batch substitution, missing controls and forged verdict',()=>{
  const report=dashboard();
  const one=index.batches[0];
  const valid=buildAssessmentReviewDossiers({queue,controlIds:one.controlIds,details:one.controlIds.map(details)});
  assert.throws(()=>buildOfflineOperatorReviewDashboard(index,[],rev),/Complete authoritative/);
  assert.throws(()=>buildOfflineOperatorReviewDashboard(index,[{
    ...valid,targetRevision:'f'.repeat(40)
  }],rev),/target revision|changed|digest mismatch/);
  assert.throws(()=>buildOfflineOperatorReviewDashboard(index,[{
    ...valid,dossiers:valid.dossiers.map((d,i)=>i?d:{...d,outcome:'passed'})
  }],rev),/rejects inferred verdict|digest mismatch/);
  assert.throws(()=>buildOfflineOperatorReviewDashboard(index,[{
    ...valid,controlIds:[...valid.controlIds].reverse()
  }],rev),/rejects inferred verdict|digest mismatch/);
  assert.throws(()=>renderOfflineOperatorReviewHtml({
    ...report,securityStateChanged:true
  }),/cannot accept security authority/);
});

test('refuses symlink output directory instead of following it',()=>{
  const base=fs.mkdtempSync(path.join(os.tmpdir(),'arl-link-review-'));
  try {
    const real=path.join(base,'actual');
    const link=path.join(base,'link');
    fs.mkdirSync(real);
    fs.symlinkSync(real,link);
    assert.throws(()=>writeOfflineOperatorReviewDashboard({
      dashboard:dashboard(),outputDirectory:link
    }),/symlinked ancestors|real directory/);
  } finally {
    fs.rmSync(base,{recursive:true,force:true});
  }
});


test('rejects mutated evidence trust after dossier preparation, even with unchanged control queue', () => {
  const one=index.batches[0];
  const before=buildAssessmentReviewDossiers({queue,controlIds:one.controlIds,details:one.controlIds.map(details)});
  const changed=one.controlIds.map(details);
  changed[0].evidence[0].verificationState='verified';
  const after=buildAssessmentReviewDossiers({queue,controlIds:one.controlIds,details:changed});
  assert.notEqual(before.preparationDigestSha256,after.preparationDigestSha256);
  assert.throws(()=>buildOfflineOperatorReviewDashboard(index,[{
    ...before,dossiers:after.dossiers
  }],rev),/dossier content digest mismatch/);
});

test('does not reuse a publicly readable existing export',()=>{
  const directory=fs.mkdtempSync(path.join(os.tmpdir(),'arl-review-public-file-'));
  try {
    const original=writeOfflineOperatorReviewDashboard({dashboard:dashboard(),outputDirectory:directory});
    fs.chmodSync(original.path,0o644);
    assert.throws(()=>writeOfflineOperatorReviewDashboard({dashboard:dashboard(),outputDirectory:directory}),
      /non-private immutable/);
  } finally { fs.rmSync(directory,{recursive:true,force:true}); }
});

test('atomic output leaves no temporary files and rejects group-readable output directories',()=>{
  const directory=fs.mkdtempSync(path.join(os.tmpdir(),'arl-review-private-dir-'));
  try {
    const created=writeOfflineOperatorReviewDashboard({dashboard:dashboard(),outputDirectory:directory});
    assert.equal(created.status,'created');
    assert.deepEqual(fs.readdirSync(directory),[path.basename(created.path)]);
    fs.chmodSync(directory,0o750);
    assert.throws(()=>writeOfflineOperatorReviewDashboard({dashboard:dashboard(),outputDirectory:directory}),
      /private real directory/);
  } finally { fs.rmSync(directory,{recursive:true,force:true}); }
});
