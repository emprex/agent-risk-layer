import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {auditAssessmentStaticArtifacts} from '../src/agent/assessment-static-integrity-audit.mjs';
test('integrity audit is a function and routes through the frozen authoritative CLI',()=>{
  assert.equal(typeof auditAssessmentStaticArtifacts,'function');
  const source=readFileSync(new URL('../src/agent/local-assessment-workflow.mjs',import.meta.url),'utf8');
  const i=source.indexOf('if (/^Audit assessment static integrity');
  const j=source.indexOf('if (/^Persist assessment static batch',i);
  assert.ok(i>0&&j>i);
  const block=source.slice(i,j);
  for(const part of ['ARL_EXPECTED_TARGET_SHA','ARL_EXPECTED_PROJECT_ID',
    'ARL_EXPECTED_SYSTEM_SNAPSHOT_ID','auditAssessmentStaticArtifacts',
    'deploymentDecisionWritten:false'])
    assert.ok(block.includes(part),part);
  const route=/^Audit assessment static integrity[.!?]*$/i;
  assert.ok(route.test('Audit assessment static integrity'));
  assert.ok(!route.test('Persist assessment static batch 1'));
});
