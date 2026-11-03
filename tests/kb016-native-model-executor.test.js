import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { executeKb016NativeModelProbe, KB016_MODEL_CASES } from '../src/agent/kb016-native-model-executor.mjs';

const revision = 'b3116fcfcec3bf6967773c3e9587c502b1fed5e5';
const snapshotId = 'sys_synthetic_kb016';
const options = {origin:'http://127.0.0.1:8787',token:'synthetic-unit-token',
  targetRevision:revision,snapshotId};

function mockAdapter({tamper} = {}) {
  const seen = [];
  return {seen, async fetchImpl(url,init) {
    assert.equal(String(url),'http://127.0.0.1:8787/agentrisklayer/evaluate');
    assert.equal(init.redirect,'error');
    assert.equal(init.headers.authorization,'Bearer synthetic-unit-token');
    const body=JSON.parse(init.body);
    assert.equal(body.targetRevision,revision);
    assert.deepEqual(body.syntheticContext,{
      dryRun:true,credentials:'synthetic-only',snapshotId
    });
    seen.push(body.caseId);
    const expected=KB016_MODEL_CASES.find(x=>x[0]===body.caseId)?.[1];
    assert.ok(expected);
    const obs={
      schema:'arl.kb016.model-selection-observation.v1',
      controlId:'ARL-KB-016',caseId:body.caseId,
      targetRevision:revision,systemSnapshotId:snapshotId,
      targetObserved:true,dryRun:true,syntheticOnly:true,
      nativeMethod:'AugmentedLLM.select_model',
      requestModel:expected, selectedModel:expected,requestModelSelected:true,
      modelLoaded:false,inferenceExecuted:false,
      deployedModelDigestResolved:false,providerConfigurationBound:false,
      evidenceInvalidationTested:false,authorisationBypassDemonstrated:false,
      controlVerdict:'not_determined'
    };
    tamper?.(obs,body.caseId);
    return {ok:true,status:200,async json(){return {structuredOutput:obs};}};
  }};
}

test('KB-016 sends only two local snapshot-bound synthetic requests and returns inconclusive',async()=>{
  const adapter=mockAdapter();
  const result=await executeKb016NativeModelProbe({...options,fetchImpl:adapter.fetchImpl});
  assert.deepEqual(adapter.seen,KB016_MODEL_CASES.map(x=>x[0]));
  assert.equal(result.status,'native_selection_observed_inconclusive');
  assert.equal(result.automaticPass,false);
  assert.equal(result.evidenceInvalidationTested,false);
  assert.equal(result.deployedModelDigestResolved,false);
  assert.equal(result.deploymentDecisionWritten,false);
  assert.equal(result.observations.length,2);
});

test('KB-016 rejects wrong snapshot, non-local origin, or missing token before dispatch',async()=>{
  const cases=[
    {...options,origin:'https://example.com'},
    {...options,origin:'http://127.0.0.1:8787/path'},
    {...options,token:''},
    {...options,targetRevision:'changed'},
    {...options,snapshotId:'not-a-snapshot'}
  ];
  for(const input of cases){
    await assert.rejects(()=>executeKb016NativeModelProbe(input));
  }
});

test('KB-016 blocks forged digest/invalidated evidence or wrong schema',async()=>{
  for(const change of [
    obs=>{obs.deployedModelDigestResolved=true;},
    obs=>{obs.evidenceInvalidationTested=true;},
    obs=>{obs.controlVerdict='passed';},
    obs=>{obs.systemSnapshotId='sys_different';},
    obs=>{obs.selectedModel=123;}
  ]){
    const adapter=mockAdapter({tamper:change});
    const outcome=await executeKb016NativeModelProbe({...options,fetchImpl:adapter.fetchImpl});
    assert.equal(outcome.status,'blocked');
    assert.equal(outcome.automaticPass,false);
    assert.equal(adapter.seen.length,1);
  }
});

test('KB-016 operator execution remains human-gated and unverified',()=>{
  const workflow=fs.readFileSync(new URL('../src/agent/local-assessment-workflow.mjs',import.meta.url),'utf8');
  assert.match(workflow,/controlId === 'ARL-KB-016'/);
  assert.match(workflow,/action\.name !== 'perform_authorised_control_test'/);
  assert.match(workflow,/source_type='active_test_plan_authorisation' AND source_reference=\?/);
  assert.match(workflow,/item\.status === 'active'/);
  assert.match(workflow,/result:'inconclusive'/);
  assert.match(workflow,/automaticPass:false/);
  assert.match(workflow,/No PASS\/FAIL or deployment approval/);
});
