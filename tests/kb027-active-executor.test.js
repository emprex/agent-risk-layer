import test from 'node:test';
import assert from 'node:assert/strict';
import {executeKb027ActiveTest,KB027_CASES} from '../src/agent/kb027-active-executor.mjs';
const REV='a'.repeat(40), SNAP='sys_synthetic_001';
const base={origin:'http://127.0.0.1:8787',token:'dummy',targetRevision:REV,snapshotId:SNAP};
test('seven synthetic cases produce review-required, never automatic PASS',async()=>{
 let index=0;
 const result=await executeKb027ActiveTest({...base,fetchImpl:async(_url,req)=>{
  const payload=JSON.parse(req.body);
  const [caseId,decision]=KB027_CASES[index++];
  assert.equal(payload.caseId,'KB027-'+caseId);
  assert.equal(payload.syntheticContext.dryRun,true);
  return {ok:true,json:async()=>({structuredOutput:{
   schema:'arl.kb027.key-authorization-observation.v1',controlId:'ARL-KB-027',
   caseId:payload.caseId,targetRevision:REV,systemSnapshotId:SNAP,
   targetObserved:true,dryRun:true,syntheticOnly:true,decision,
   auditCorrelated:true,downstreamStateChecked:true,
   unauthorisedSideEffectObserved:false,credentialReference:'synthetic:test'
  }})};
 }});
 assert.equal(index,7);assert.equal(result.status,'runtime_cases_completed_review_required');
 assert.equal(result.automaticPass,false);
});
test('unsupported adapter cannot claim a verdict',async()=>{
 const out=await executeKb027ActiveTest({...base,fetchImpl:async()=>({ok:false,status:400})});
 assert.equal(out.status,'blocked');assert.equal(out.observations.length,0);
});
test('missing real target-observed evidence is inconclusive',async()=>{
 const out=await executeKb027ActiveTest({...base,fetchImpl:async()=>({ok:true,json:async()=>({
  structuredOutput:{decision:'denied'}})})});
 assert.equal(out.status,'inconclusive');
});
test('non-loopback adapter rejected before network call',async()=>{
 await assert.rejects(executeKb027ActiveTest({...base,origin:'https://example.com'}));
});
test('observed prohibited access is candidate finding, not automatic FAIL',async()=>{
 let index=0;
 const out=await executeKb027ActiveTest({...base,fetchImpl:async(_url,req)=>{
  const p=JSON.parse(req.body);const [caseId,expected]=KB027_CASES[index++];
  return {ok:true,json:async()=>({structuredOutput:{
   schema:'arl.kb027.key-authorization-observation.v1',controlId:'ARL-KB-027',
   caseId:p.caseId,targetRevision:REV,systemSnapshotId:SNAP,
   targetObserved:true,dryRun:true,syntheticOnly:true,
   decision:expected==='denied'?'permitted':expected,
   auditCorrelated:true,downstreamStateChecked:true,
   unauthorisedSideEffectObserved:expected==='denied',
   credentialReference:'synthetic:abc'
  }})};
 }});
 assert.equal(out.status,'observed_policy_failure_candidate');
 assert.equal(out.automaticPass,false);
});
