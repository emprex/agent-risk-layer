import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {requireAuthorisedTestNonExecution} from '../src/agent/authorised-test-non-execution.mjs';

const snapshotId='sys_test';
const revision='a'.repeat(40);
const auth='roe:synthetic';
function fixture() {
  return {
    controlId:'ARL-KB-009',
    reason:'There is no reviewed bounded KB-009 executor; runtime test not run.',
    sourceReference:'human:kb009:operator-observation',
    state:{
      stage:'authorised_active_test_execution_required',
      nextAllowedAction:{name:'perform_authorised_control_test',actor:'user',requiresUserInput:true,
        controlId:'ARL-KB-009',authorisationReference:auth},
      authoritativeArtifacts:{assessmentContext:{systemSnapshotId:snapshotId}}
    },
    frozenInspection:{
      target:{revision,dirty:false},
      binding:{verified:true,revisionBefore:revision,revisionAfter:revision}
    },
    detail:{
      control:{id:'ARL-KB-009'},
      systemSnapshot:{id:snapshotId,assessmentConfiguration:{targetBinding:{revision}}},
      chain:{currentStage:'test',status:'test_inconclusive'},
      tests:[],
      evidence:[{sourceType:'active_test_plan_authorisation',sourceReference:auth,
        systemSnapshotId:snapshotId,verificationState:'verified',retentionStatus:'active'}]
    }
  };
}

test('permits only explicit, authorised, non-executed current-snapshot disposition',()=>{
  assert.deepEqual(requireAuthorisedTestNonExecution(fixture()),
    {snapshotId,revision,authorisationReference:auth});
});

test('refuses missing authorisation and changed/dirty target',()=>{
  for (const mutation of [
    x=>{x.detail.evidence=[];},
    x=>{x.state.nextAllowedAction.authorisationReference='wrong';},
    x=>{x.frozenInspection.target.dirty=true;},
    x=>{x.frozenInspection.binding.revisionAfter='b'.repeat(40);},
    x=>{x.detail.systemSnapshot.id='sys_other';},
    x=>{x.detail.chain.status='passed';},
    x=>{x.state.nextAllowedAction.controlId='ARL-KB-010';},
    x=>{x.reason='short';}
  ]) {
    const x=fixture();mutation(x);
    assert.throws(()=>requireAuthorisedTestNonExecution(x));
  }
});

test('cannot claim non-execution after an authorised active test exists',()=>{
  const x=fixture();
  x.detail.tests=[{systemSnapshotId:snapshotId,executionMethod:'authorised_manual_active_test'}];
  assert.throws(()=>requireAuthorisedTestNonExecution(x),/already exists/);
});

test('non-execution workflow writes only an administrative event, no test/evidence',()=>{
  const source=fs.readFileSync(new URL('../src/agent/local-assessment-workflow.mjs',import.meta.url),'utf8');
  const section=source.split("if (request.startsWith('Document authorised test not executed ')) {")[1]
    .split("if (request.startsWith('Record active control test result ')) {")[0];
  assert.match(section,/requireAuthorisedTestNonExecution/);
  assert.match(section,/dispositionBasis: 'authorised_test_not_executed'/);
  assert.match(section,/testExecutionId: null/);
  assert.match(section,/securityStateChanged: false/);
  assert.doesNotMatch(section,/await recordControlTestExecution\(/);
  assert.doesNotMatch(section,/await recordControlEvidence\(/);
  assert.doesNotMatch(section,/await verifyExplicitHumanEvidence\(/);
});
