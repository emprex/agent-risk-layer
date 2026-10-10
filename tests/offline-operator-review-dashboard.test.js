import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { buildControlWorkQueue } from '../src/agent/control-work-queue.mjs';
import { buildSyntheticOperatorDemo } from '../scripts/generate-synthetic-operator-dashboard.mjs';
import { buildAssessmentEvidenceBatchIndex } from '../src/agent/assessment-evidence-batch-index.mjs';
import { buildAssessmentReviewDossiers } from '../src/agent/assessment-review-dossiers.mjs';
import {
  buildOfflineOperatorReviewDashboard,
  buildOperatorReviewWorkplan,
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
  return buildOfflineOperatorReviewDashboard(index,[review],rev,queue);
}

test('real 4-control scenario renders 2 review controls and explicitly excludes held findings',()=>{
  const report=dashboard();
  assert.equal(report.assessedControls,2);
  assert.equal(report.excludedControls,2);
  assert.equal(report.registryTotal,4);
  assert.deepEqual(report.controlRegistry.map(x=>x.controlId),
    ['ARL-KB-001','ARL-KB-006','ARL-KB-007','ARL-KB-008']);
  const blocked=report.controlRegistry.find(x=>x.controlId==='ARL-KB-006');
  assert.equal(blocked.lane,'follow_up_blocked');
  assert.equal(blocked.chainStatus,'finding_open');
  assert.equal(blocked.inEvidenceWorkplan,false);
  const human=report.controlRegistry.find(x=>x.controlId==='ARL-KB-001');
  assert.equal(human.lane,'human_decision');
  assert.equal(human.inEvidenceWorkplan,false);
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
  assert.match(html,/All 4 controls — authoritative snapshot/);
  assert.match(html,/Controls requiring separate follow-up — 2/);
  assert.match(html,/Show complete 4-control status table/);
  const visibleStart=html.indexOf('Controls requiring separate follow-up — 2');
  const collapsedStart=html.indexOf('<details><summary>Show complete 4-control status table',visibleStart);
  assert.ok(visibleStart>0 && collapsedStart>visibleStart);
  const visible=html.slice(visibleStart,collapsedStart);
  assert.match(visible,/ARL-KB-001/);
  assert.match(visible,/ARL-KB-006/);
  assert.doesNotMatch(visible,/ARL-KB-007|ARL-KB-008/);
  assert.match(visible,/finding open/);
  assert.match(visible,/Human decision-stage record/);
  assert.match(html,/ARL-KB-001/);
  assert.match(html,/ARL-KB-006/);
  assert.match(html,/Human decision stage does not prove human approval/);
  assert.doesNotMatch(html,/id="ARL-KB-006"/);
  assert.match(html,/&lt;script&gt;alert\(1\)&lt;\/script&gt;/);
  assert.doesNotMatch(html,/<script>|onerror=/);
  assert.match(html,/default-src &#39;none&#39;/);
  assert.match(html,/No PASS\/FAIL inferred/);
  assert.doesNotMatch(html,/https?:\/\//);
});


test('full synthetic review has a usable offline work plan without increasing evidence authority', () => {
  const report = buildSyntheticOperatorDemo();
  const streams = buildOperatorReviewWorkplan(report);
  assert.equal(report.assessedControls, 98);
  assert.equal(report.excludedControls, 10);
  assert.equal(report.registryTotal,108);
  assert.equal(new Set(report.controlRegistry.map(x=>x.controlId)).size,108);
  const excluded=report.controlRegistry.filter(x=>!x.inEvidenceWorkplan);
  assert.deepEqual(excluded.map(x=>x.controlId),
    [1,2,3,4,5,6,46,57,90,100].map(n=>'ARL-KB-'+String(n).padStart(3,'0')));
  assert.equal(excluded.filter(x=>x.lane==='human_decision').length,9);
  assert.deepEqual(excluded.filter(x=>x.lane==='follow_up_blocked')
    .map(x=>x.controlId),['ARL-KB-006']);
  assert.deepEqual(streams.map(s => s.id),
    ['frozen-source','human-records','runtime-authorisation','source-lineage']);
  for (const stream of streams) {
    assert.equal(stream.controlCount, stream.controls.length);
    assert.equal(stream.requirementCount,
      stream.controls.reduce((sum, control) => sum + control.requirementCount, 0));
    assert.ok(stream.controls.every(c => report.controls.some(d => d.controlId === c.id)));
  }
  assert.ok(streams[0].controlCount > 0);
  assert.equal(streams[1].controlCount, 98);
  assert.equal(streams[2].controlCount, 98);
  const html = renderOfflineOperatorReviewHtml(report);
  assert.match(html, /Evidence work plan/);
  assert.match(html, /Streams overlap/);
  assert.match(html, /All 98 independent controls/);
  assert.match(html, /All 108 controls — authoritative snapshot/);
  assert.match(html, /Controls requiring separate follow-up — 10/);
  assert.match(html, /Show complete 108-control status table/);
  const visibleStart=html.indexOf('Controls requiring separate follow-up — 10');
  const collapsedStart=html.indexOf('<details><summary>Show complete 108-control status table',visibleStart);
  assert.ok(visibleStart>0 && collapsedStart>visibleStart);
  const visible=html.slice(visibleStart,collapsedStart);
  for(const record of excluded) assert.match(visible,new RegExp(record.controlId));
  assert.doesNotMatch(visible,/ARL-KB-007|ARL-KB-008/);
  assert.match(visible,/not prove human approval/i);
  assert.match(visible,/Deployment HOLD/);
  assert.match(html, /Show all 98 control links/);
  assert.match(html, /Separately authorised runtime checks/);
  assert.match(html, /Deployment HOLD/);
  assert.match(html, /SYNTHETIC DEMONSTRATION/);
  assert.doesNotMatch(html, /<script\b|<form\b|onerror=/i);
  assert.doesNotMatch(html, /https?:\/\//);
  assert.equal(report.testsExecuted, 0);
  assert.equal(report.evidenceAutomaticallyVerified, 0);
  assert.equal(report.deploymentDecisionWritten, false);
});

test('offline work-plan count metadata fails closed and cannot accept a forged result', () => {
  const report = dashboard();
  assert.throws(() => buildOperatorReviewWorkplan({
    ...report,
    controls: report.controls.map((c, index) => index ? c :
      { ...c, summary: { ...c.summary, requiresHumanDocuments: -1 } })
  }), /bounded evidence requirement counts/);
  assert.throws(() => buildOperatorReviewWorkplan({
    ...report,
    controls: report.controls.map((c, index) => index ? c : { ...c, outcome:'passed' })
  }), /foreign control or inferred result/);
  assert.throws(() => buildOperatorReviewWorkplan({
    ...report, targetRevision: 'not-a-sha'
  }), /complete frozen operator dashboard/);
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
  assert.throws(()=>buildOfflineOperatorReviewDashboard(index,[],rev,queue),/Complete authoritative/);
  assert.throws(()=>buildOfflineOperatorReviewDashboard(index,[{
    ...valid,targetRevision:'f'.repeat(40)
  }],rev,queue),/target revision|changed|digest mismatch/);
  assert.throws(()=>buildOfflineOperatorReviewDashboard(index,[{
    ...valid,dossiers:valid.dossiers.map((d,i)=>i?d:{...d,outcome:'passed'})
  }],rev,queue),/rejects inferred verdict|digest mismatch/);
  assert.throws(()=>buildOfflineOperatorReviewDashboard(index,[{
    ...valid,controlIds:[...valid.controlIds].reverse()
  }],rev,queue),/rejects inferred verdict|digest mismatch/);
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
  }],rev,queue),/dossier content digest mismatch/);
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

test('full control register cannot come from wrong snapshot, missing lanes or forged identities',()=>{
  const batch=index.batches[0];
  const review=buildAssessmentReviewDossiers({
    queue, controlIds:batch.controlIds, details:batch.controlIds.map(details)
  });
  assert.throws(()=>buildOfflineOperatorReviewDashboard(index,[review],rev),
    /same-snapshot authoritative/);
  assert.throws(()=>buildOfflineOperatorReviewDashboard(index,[review],rev,{
    ...queue,systemSnapshotId:'foreign-snapshot'
  }), /same-snapshot authoritative/);
  assert.throws(()=>buildOfflineOperatorReviewDashboard(index,[review],rev,{
    ...queue,lanes:{...queue.lanes,human_decision:[]}
  }), /incomplete or inconsistent/);
  assert.throws(()=>buildOfflineOperatorReviewDashboard(index,[review],rev,{
    ...queue,lanes:{...queue.lanes,test_planning:[
      ...queue.lanes.test_planning,{...queue.lanes.human_decision[0]}
    ]}
  }), /contradicts the evidence work queue/);
  assert.throws(()=>renderOfflineOperatorReviewHtml({
    ...dashboard(),controlRegistry:dashboard().controlRegistry.slice(1)
  }), /Validated operator dashboard required/);
});

test('excluded-control nextAction never copies private free text into offline HTML',()=>{
  const batch=index.batches[0];
  const review=buildAssessmentReviewDossiers({
    queue, controlIds:batch.controlIds, details:batch.controlIds.map(details)
  });
  const secret='PRIVATE-client-email-and-key-never-export-this-text';
  const withPrivateNextAction={
    ...queue,lanes:{
      ...queue.lanes,
      follow_up_blocked:queue.lanes.follow_up_blocked.map(x=>({...x,nextAction:secret})),
      human_decision:queue.lanes.human_decision.map(x=>({...x,nextAction:secret}))
    }
  };
  const result=buildOfflineOperatorReviewDashboard(index,[review],rev,withPrivateNextAction);
  const html=renderOfflineOperatorReviewHtml(result);
  assert.doesNotMatch(html,new RegExp(secret));
  assert.equal(result.registryTotal,4);
  assert.equal(result.deploymentDecisionWritten,false);
});
