import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import {
  buildSyntheticOperatorDemo,
  writeSyntheticOperatorDemo,
  DEMO_SNAPSHOT,
  DEMO_REVISION
} from '../scripts/generate-synthetic-operator-dashboard.mjs';

test('synthetic 108-control demonstration preserves held KB-006 and all decision boundaries', () => {
  const dashboard=buildSyntheticOperatorDemo();
  assert.equal(dashboard.syntheticDemo,true);
  assert.equal(dashboard.systemSnapshotId,DEMO_SNAPSHOT);
  assert.equal(dashboard.targetRevision,DEMO_REVISION);
  assert.equal(dashboard.assessedControls,98);
  assert.equal(dashboard.excludedControls,10);
  assert.equal(dashboard.controls.length,98);
  assert.ok(!dashboard.controls.some(c=>c.controlId==='ARL-KB-006'));
  assert.ok(dashboard.controls.every(c=>
    c.outcome==='operator_review_required' &&
    c.criteria.every(k=>k.criterionSatisfied===false) &&
    c.evidenceAutomaticallyAccepted===false &&
    c.findingAutomaticallyClosed===false));
  assert.ok(dashboard.controls.some(c=>c.summary.sourceMetadataCandidates>0));
  assert.ok(dashboard.controls.some(c=>c.summary.missingStaticMetadata>0));
  assert.ok(dashboard.controls.some(c=>c.summary.currentUnverifiedEvidence>0));
  assert.equal(dashboard.evidenceAutomaticallyVerified,0);
  assert.equal(dashboard.testsExecuted,0);
  assert.equal(dashboard.evidencePersisted,0);
  assert.equal(dashboard.securityStateChanged,false);
  assert.equal(dashboard.deploymentDecisionWritten,false);
});

test('one command writes an immutable clearly watermarked synthetic HTML demo',()=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'arl-synthetic-operator-'));
  const dir=path.join(root,'demo');
  try {
    const first=writeSyntheticOperatorDemo(dir);
    const second=writeSyntheticOperatorDemo(dir);
    assert.equal(first.status,'created');
    assert.equal(second.status,'unchanged');
    assert.equal(first.sha256,second.sha256);
    assert.equal(first.controls,98);
    assert.equal(first.synthetic,true);
    assert.equal(fs.statSync(first.path).mode & 0o777,0o600);
    assert.equal(fs.readdirSync(dir).length,1);
    const html=fs.readFileSync(first.path,'utf8');
    assert.match(html,/SYNTHETIC DEMONSTRATION — NO REAL ASSESSMENT OR CUSTOMER DATA/);
    assert.match(html,/Deployment HOLD/);
    assert.match(html,/No PASS\/FAIL inferred/);
    assert.match(html,/ARL-KB-007/);
    assert.match(html,/SYNTHETIC_DEMO_NOT_AN_ASSESSMENT/);
    assert.doesNotMatch(html,/id="ARL-KB-006"/);
    assert.doesNotMatch(html,/<script\b|<iframe\b|<form\b|https?:\/\//);
    assert.match(html,/default-src &#39;none&#39;/);
  } finally {fs.rmSync(root,{recursive:true,force:true});}
});
