import test from 'node:test';
import assert from 'node:assert/strict';
import { assessIndependentControlTestGate } from '../src/agent/independent-control-test-gate.mjs';

const REV = 'b3116fcfcec3bf6967773c3e9587c502b1fed5e5';
const SNAP = 'sys_3ab269f861d04cea98f84b9b0ba26290';
function fixture() {
  return {
    controlId:'ARL-KB-027', assessmentId:'assessment-local', expectedSnapshotId:SNAP,
    frozenInspection:{
      binding:{verified:true,revisionBefore:REV,revisionAfter:REV},
      target:{revision:REV,dirty:false}
    },
    detail:{
      control:{id:'ARL-KB-027'}, chain:{currentStage:'test'},
      systemSnapshot:{id:SNAP,assessmentConfiguration:{
        targetBinding:{source:'git',revision:REV},
        assessmentBinding:{assessmentId:'assessment-local'}
      }},
      testDefinition:{id:'ARL-CHK-027',digest:'a'.repeat(64),requiredEvidence:['record']}
    }
  };
}
test('allows independent test preflight while unrelated finding remains open',()=>{
  const input=fixture();
  input.detail.findings=[{controlId:'ARL-KB-006',status:'open'}];
  const result=assessIndependentControlTestGate(input);
  assert.equal(result.available,true);
  assert.equal(result.runtimeTestAuthorised,false);
  assert.equal(result.testExecuted,false);
  assert.equal(result.securityStateChanged,false);
});
for (const [name,modify] of [
  ['wrong snapshot',x=>x.detail.systemSnapshot.id='other'],
  ['wrong git revision',x=>x.detail.systemSnapshot.assessmentConfiguration.targetBinding.revision='0'.repeat(40)],
  ['dirty target',x=>x.frozenInspection.target.dirty=true],
  ['unverified target',x=>x.frozenInspection.binding.verified=false],
  ['wrong assessment',x=>x.detail.systemSnapshot.assessmentConfiguration.assessmentBinding.assessmentId='other'],
  ['wrong control',x=>x.detail.control.id='ARL-KB-028'],
  ['wrong stage',x=>x.detail.chain.currentStage='remediation'],
  ['wrong check ID',x=>x.detail.testDefinition.id='ARL-CHK-026'],
  ['missing checklist',x=>delete x.detail.testDefinition.requiredEvidence],
]) {
  test('rejects '+name,()=>{
    const input=fixture();
    modify(input);
    assert.equal(assessIndependentControlTestGate(input).available,false);
  });
}
