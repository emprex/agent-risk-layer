import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { requireUnauthorisedTestNonExecution } from '../src/agent/unauthorised-test-non-execution.mjs';

const revision='a'.repeat(40), snapshotId='sys_test', controlId='ARL-KB-012';
function fixture(){
  return {
    controlId, reason:'No approved bounded executor or experimental identity isolation scope is available.',
    sourceReference:'human:kb012:nonexecution',
    state:{stage:'active_test_plan_required',
      nextAllowedAction:{name:'define_and_authorise_control_test',actor:'human',requiresUserInput:true,controlId,authorisationReference:null},
      authoritativeArtifacts:{assessmentContext:{systemSnapshotId:snapshotId}}},
    frozenInspection:{target:{revision,dirty:false},binding:{verified:true,revisionBefore:revision,revisionAfter:revision}},
    detail:{control:{id:controlId},systemSnapshot:{id:snapshotId,assessmentConfiguration:{targetBinding:{revision}}},
      chain:{currentStage:'test',status:'test_inconclusive'},evidence:[],tests:[]}
  };
}
test('allows only current explicit human planning refusal',()=>{
  assert.deepEqual(requireUnauthorisedTestNonExecution(fixture()),{snapshotId,revision});
});
test('refuses wrong stage, actor, control, or authorisation',()=>{
  for(const mutation of [
    x=>{x.state.stage='authorised_active_test_execution_required';},
    x=>{x.state.nextAllowedAction.actor='arl';},
    x=>{x.state.nextAllowedAction.controlId='ARL-KB-013';},
    x=>{x.state.nextAllowedAction.authorisationReference='roe:1';},
    x=>{x.detail.evidence=[{systemSnapshotId:snapshotId,sourceType:'active_test_plan_authorisation',retentionStatus:'active'}];}
  ]){const x=fixture();mutation(x);assert.throws(()=>requireUnauthorisedTestNonExecution(x));}
});
test('refuses stale or dirty scope and conclusive control',()=>{
  for(const mutation of [
    x=>{x.frozenInspection.target.dirty=true;},
    x=>{x.detail.systemSnapshot.id='old';},
    x=>{x.frozenInspection.binding.revisionAfter='b'.repeat(40);},
    x=>{x.detail.chain.status='passed';},
    x=>{x.reason='too short';}
  ]){const x=fixture();mutation(x);assert.throws(()=>requireUnauthorisedTestNonExecution(x));}
});
test('refuses existing active execution including history',()=>{
  const x=fixture();
  x.detail.testHistory=[{systemSnapshotId:snapshotId,executionMethod:'authorised_local_active_test'}];
  assert.throws(()=>requireUnauthorisedTestNonExecution(x),/already exists/);
});
test('administrative handler does not create test, authorisation or evidence',()=>{
  const source=fs.readFileSync(new URL('../src/agent/local-assessment-workflow.mjs',import.meta.url),'utf8');
  const section=source.split("if (request.startsWith('Document unapproved test not executed ')) {")[1]
    .split('  // Explicit human administrative disposition')[0];
  assert.ok(section);
  assert.match(section,/requireUnauthorisedTestNonExecution/);
  assert.match(section,/dispositionBasis: 'human_declined_test_authorisation'/);
  assert.match(section,/testExecutionId: null, evidenceId: null/);
  assert.match(section,/securityStateChanged: false/);
  assert.doesNotMatch(section,/recordControlTestExecution\(/);
  assert.doesNotMatch(section,/recordControlEvidence\(/);
  assert.doesNotMatch(section,/createRedTeamAuthorisation\(/);
});
