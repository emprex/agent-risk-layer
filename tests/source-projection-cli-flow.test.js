import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

test('one-command recapture is an explicit request and refuses partial refresh before report export',()=>{
 const src=readFileSync(new URL('../src/agent/arl-local-assessment-runner.mjs',import.meta.url),'utf8');
 const a=src.indexOf('if (/^Refresh source projections and export client preassessment');
 const b=src.indexOf('if (/^Export client preassessment',a);
 assert.ok(a>0&&b>a);
 const block=src.slice(a,b);
 for(const marker of ['Refresh assessment source projections v2 all batches',
  'sourceProjectionRefresh','ARL_EXPECTED_SYSTEM_SNAPSHOT_ID',
  'summary.controlCount','refusing misleading export',
  'Build assessment action dossiers','writeClientPreassessment',
  'Human-review draft only'])
  assert.ok(block.includes(marker),marker);
 assert.ok(block.indexOf('Refresh assessment source projections v2 all batches')<
  block.indexOf('Build assessment action dossiers'));
 assert.ok(block.indexOf('Build assessment action dossiers')<
  block.indexOf('writeClientPreassessment'));
 assert.doesNotMatch(block,/buildAiAssistedPreassessment|recordDeploymentDecision/);
 const route=/^Refresh source projections and export client preassessment[.!?]*$/i;
 assert.ok(route.test('Refresh source projections and export client preassessment'));
 assert.ok(!route.test('Export client preassessment'));
 assert.ok(!route.test('Refresh source projections and export client preassessment FORCED'));
});
