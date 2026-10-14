import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {planStaticEvidenceBatch} from '../src/agent/bounded-static-evidence-batch.mjs';

const ids=Array.from({length:99},(_,i)=>'ARL-KB-'+String(i+1).padStart(3,'0'));
function fixture(){
  return {schema:'arl.agent.assessment-evidence-batch-index.v1',
    systemSnapshotId:'sys_test',queueTotal:108,eligibleControls:99,excludedControls:9,
    batchSize:20,batchCount:5,
    batches:Array.from({length:5},(_,i)=>({controlIds:ids.slice(i*20,i*20+20)})),
    securityStateChanged:false,deploymentDecisionWritten:false,humanReviewRequired:true};
}
test('bounded plan covers 99 eligible controls over five resumable batches',()=>{
  const index=fixture();
  const plans=index.batches.map((_,i)=>planStaticEvidenceBatch(index,i+1,'sys_test'));
  assert.deepEqual(plans.map(x=>x.requested),[20,20,20,20,19]);
  assert.equal(new Set(plans.flatMap(x=>x.controlIds)).size,99);
  assert.equal(plans[0].passFailInferred,false);
  assert.throws(()=>planStaticEvidenceBatch(index,6,'sys_test'),/invalid or outside bounds/);
  assert.throws(()=>planStaticEvidenceBatch(index,1,'other'),/exact authoritative/);
});
test('bounded plan fails closed on overlapping controls or corrupted coverage',()=>{
  const a=fixture();a.batches[1].controlIds[0]=a.batches[0].controlIds[0];
  assert.throws(()=>planStaticEvidenceBatch(a,1,'sys_test'),/non-overlapping/);
  const b=fixture();b.eligibleControls=100;
  assert.throws(()=>planStaticEvidenceBatch(b,1,'sys_test'),/non-overlapping/);
});
test('persistence command checks exact frozen scope and delegates to existing append-only ledger',()=>{
  const source=readFileSync(new URL('../src/agent/local-assessment-workflow.mjs',import.meta.url),'utf8');
  const start=source.indexOf('if (/^Persist assessment static batch');
  const end=source.indexOf('if (/^Build assessment batch review dossier',start);
  assert.ok(start>0&&end>start);
  const block=source.slice(start,end);
  for(const token of ['ARL_EXPECTED_PROJECT_ID','ARL_EXPECTED_SYSTEM_SNAPSHOT_ID',
    'ARL_EXPECTED_TARGET_SHA','queue.total !== 108','planStaticEvidenceBatch',
    "detail.chain?.currentStage !== 'test'",'runAuthoritativeControlSourceReview',
    'collectionOnly:true','deploymentDecisionWritten:false'])
    assert.ok(block.includes(token),token);
  assert.ok(!block.includes('recordDeploymentDecision('));
});
