import test from 'node:test';
import assert from 'node:assert/strict';

import {
  projectCustomerAssessmentReport,
  renderCustomerAssessmentReport
} from '../src/agent/customer-assessment-report.mjs';
import { buildCustomerAssessmentDeliverable }
  from '../src/agent/customer-assessment-deliverable.mjs';

const revision='b'.repeat(40);
const raw=[
  'secret-synthetic-token-NEVER-EXPORT',
  'customer-record-synthetic-private-NEVER-EXPORT',
  'Authorization: Bearer synthetic-leak-NEVER-EXPORT',
  'internal-payload-synthetic-NEVER-EXPORT'
];

function fixture() {
  const source={
    control:{id:'ARL-KB-055',title:'Synthetic tool permission boundary'},
    chain:{currentStage:'test',chainStatus:'test_inconclusive',deploymentImpact:'hold'},
    systemSnapshot:{id:'synthetic-snapshot-id'},
    testHistory:[{
      id:'ctx_synthetic_01',executionKind:'initial',result:'inconclusive',
      executionMethod:'synthetic_offline',
      expectedResult:raw[0],observedResult:raw[1],
      failureReason:raw[2],limitations:raw[3],
      startedAt:'2026-10-10T00:00:00.000Z'
    },{
      id:'ctx_synthetic_retest',executionKind:'retest',result:'inconclusive',
      executionMethod:'synthetic_offline',
      expectedResult:raw[0],observedResult:raw[1],
      failureReason:raw[2],limitations:raw[3]
    }],
    tests:[],findings:[],remediation:[],
    evidence:[{verificationState:'unverified',retentionStatus:'active'}]
  };
  const context={
    workflowState:{
      stage:'report',
      authoritativeArtifacts:{
        frozenTarget:{revision},
        evidencePlan:{state:'review_required',boundedChecks:1,manualItems:1}
      }
    },
    reportSummary:{
      project:{name:'Synthetic-only customer'},
      systemSnapshot:{version:'synthetic-snapshot-id'},
      controlProfileVersion:'ARL-RKA-1.2.0',
      scope:{included:'Bounded synthetic scope',exclusions:'Real customer data'},
      statement:'Synthetic assessment not a customer security claim',
      disclaimer:'Synthetic-only, no approval'
    },
    readiness:{
      available:true,
      decision:'hold',
      rationale:'Missing accountable evidence and test approval',
      reasons:['Unverified synthetic evidence']
    },
    controlDetails:[source]
  };
  return {source,context};
}

test('customer projection omits all raw test and retest bodies but preserves bounded metadata',()=>{
  const {source,context}=fixture();
  const before=structuredClone(source);
  const projected=projectCustomerAssessmentReport(context);
  assert.equal(projected.available,true);
  assert.equal(projected.securityStateChanged,false);
  assert.equal(projected.deploymentDecisionWritten,false);
  assert.equal(projected.readiness.status,'HOLD');
  assert.equal(projected.controls.length,1);
  const control=projected.controls[0];
  assert.equal(control.tests.length,1);
  assert.equal(control.retests.length,1);
  for(const entry of [...control.tests,...control.retests]){
    assert.equal(entry.testExecutionId.startsWith('ctx_synthetic'),true);
    assert.equal(entry.result,'inconclusive');
    assert.equal(entry.executionMethod,'synthetic_offline');
    assert.equal(entry.restrictedTestDetailsOmitted,true);
    for(const key of ['expectedResult','observedResult','failureReason','limitations']){
      assert.match(entry[key],/omitted from customer report/);
    }
  }
  const exported=buildCustomerAssessmentDeliverable(projected);
  const json=exported.files.find(f=>f.name.endsWith('.json')&&!f.name.endsWith('.manifest.json')).content;
  const markdown=exported.files.find(f=>f.name.endsWith('.md')).content;
  assert.equal(exported.manifest.readinessStatus,'HOLD');
  for(const secret of raw){
    assert.equal(JSON.stringify(projected).includes(secret),false);
    assert.equal(json.includes(secret),false);
    assert.equal(markdown.includes(secret),false);
  }
  assert.deepEqual(source,before,'read-only customer projection must not mutate authoritative test records');
});

test('empty private fields remain null and unsafe execution IDs are not re-exported',()=>{
  const {context}=fixture();
  context.controlDetails[0].testHistory=[{
    id:'unexpected/private/id',executionKind:'initial',result:'inconclusive',
    executionMethod:'synthetic_offline',
    expectedResult:null,observedResult:'',failureReason:undefined,limitations:null
  }];
  const result=projectCustomerAssessmentReport(context);
  const projected=result.controls[0].tests[0];
  assert.equal(projected.testExecutionId,null);
  assert.equal(projected.restrictedTestDetailsOmitted,false);
  assert.equal(projected.expectedResult,null);
  assert.equal(projected.observedResult,null);
  assert.equal(projected.failureReason,null);
  assert.equal(projected.limitations,null);
  assert.equal(result.readiness.finalDecisionAuthority,'human');
  assert.equal(result.readiness.conversationLayerDecisionWritten,false);
  assert.doesNotMatch(renderCustomerAssessmentReport(result),/PROCEED/);
});
