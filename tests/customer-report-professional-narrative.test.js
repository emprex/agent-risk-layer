import assert from 'node:assert/strict';
import test from 'node:test';
import { renderCustomerAssessmentReport, projectCustomerAssessmentReport } from '../src/agent/customer-assessment-report.mjs';
import { describeCustomerReportQuality } from '../src/agent/customer-report-professional-narrative.mjs';

const revision='a'.repeat(40);
const fixture={
  schema:'arl.customer-assessment-report.v1',available:true,projection:'read_only',
  securityStateChanged:false,deploymentDecisionWritten:false,humanReviewRequired:true,
  assessment:{
    projectName:'Synthetic authorised client',targetRevision:revision,
    systemSnapshotVersion:'snapshot-7',controlProfileVersion:'ARL-RKA-1.2.0',
    scopeStatement:'Synthetic staging MCP tool/API',scopeExclusions:['Production payment system'],
    mappedControlCount:1,workflowStage:'evidence_review'
  },
  summary:{ controlsReviewed:1, applicableControls:1,observedControls:1,missingEvidence:['Pending synthetic owner sign-off']},
  readiness:{
    status:'HOLD',rationale:'Missing independent verification',
    finalDecisionRecorded:false,humanReviewRequired:true,
    finalDecisionAuthority:'human',conversationLayerDecisionWritten:false
  },
  controls:[{
    controlId:'ARL-KB-032',title:'Synthetic prompt boundary',
    applicability:{status:'applicable'},authorityState:{currentStage:'human_review'},
    evidence:{currentItems:2,verifiedActiveItems:1,verifiedActiveIds:['evi_safe_123']},
    tests:[{testExecutionId:'tst_safe_123',result:'failed',
      executionMethod:'approved_synthetic',restrictedTestDetailsOmitted:true}],
    retests:[{testExecutionId:'tst_retest_123',result:'inconclusive',
      executionMethod:'approved_synthetic_retest',restrictedTestDetailsOmitted:true}],
    findings:[{findingId:'fin_safe_123',title:'Synthetic unauthorised tool invocation',
      contextualSeverity:'high',severityStatus:'human_review_pending',status:'open'}],
    verifiedClosed:false
  }],
  limitations:['SYNTHETIC ONLY, no real customer validation.'],
  disclaimer:'SYNTHETIC ONLY'
};

test('customer narrative includes scope, evidence IDs, finding, retest and accountable limits',()=>{
  const markdown=renderCustomerAssessmentReport(structuredClone(fixture));
  for(const term of ['Assessment identity and scope','Production payment system',
    'Executive summary','fin_safe_123','evi_safe_123','tst_safe_123',
    'tst_retest_123','Independent reviewer identity','HOLD','NOT A CERTIFICATE']) {
    assert.ok(markdown.includes(term),term);
  }
  assert.match(markdown,/An individual test PASS is not a satisfied requirement/);
  assert.doesNotMatch(markdown,/PASS CERTIFIED|UKAS-accredited/i);
  const q=describeCustomerReportQuality(fixture);
  assert.equal(q.factualControlsMapped,1);
  assert.equal(q.testExecutionIds,2);
  assert.equal(q.findingIds,1);
  assert.equal(q.evidenceReferenceIds,1);
  assert.equal(q.certificationIssued,false);
  assert.equal(q.customerReleaseApproved,false);
});

test('no findings cannot silently become security PASS',()=>{
  const r=structuredClone(fixture);
  r.controls[0].findings=[];
  r.controls[0].tests=[];
  r.controls[0].retests=[];
  r.controls[0].evidence={currentItems:0,verifiedActiveItems:0};
  const markdown=renderCustomerAssessmentReport(r);
  assert.match(markdown,/does not mean the agent passed testing or has no vulnerabilities/);
  assert.match(markdown,/HOLD/);
});

test('missing identifiers, scope exclusions and coverage are explicit review gaps',()=>{
  const r=structuredClone(fixture);
  r.assessment.scopeExclusions=null;
  r.assessment.mappedControlCount=108;
  r.controls[0].findings[0].findingId=null;
  r.controls[0].tests[0].testExecutionId=null;
  r.controls[0].evidence.verifiedActiveIds=[];
  const q=describeCustomerReportQuality(r);
  for(const word of ['exclusions','population','findings','test/retest','evidence']){
    assert.ok(q.reportCompletenessGaps.some(g=>g.includes(word)),word);
  }
  assert.equal(q.humanReviewRequired,true);
});

test('reported adversarial text is not rendered as executable HTML',()=>{
  const r=structuredClone(fixture);
  r.controls[0].title='<img src=x onerror=alert(1)>';
  r.assessment.scopeStatement='<img src=x onerror=alert(1)>';
  r.limitations=['<img src=x onerror=alert(1)>'];
  const markdown=renderCustomerAssessmentReport(r);
  assert.doesNotMatch(markdown,/<img\b/i);
  assert.match(markdown,/&lt;img src=x onerror=alert\(1\)&gt;/);
});

test('source projection exposes only safe finding and verified evidence identifiers',()=>{
  const report=projectCustomerAssessmentReport({
    workflowState:{stage:'review',authoritativeArtifacts:{
      frozenTarget:{revision},evidencePlan:{state:'candidate'}
    }},
    reportSummary:{project:{name:'Synthetic client'},
      systemSnapshot:{version:7},scope:{included:'Staging',exclusions:[]}},
    readiness:{available:true,decision:'hold'},
    controlDetails:[{
      control:{id:'ARL-KB-032',title:'Synthetic'},
      applicability:{status:'applicable'},chain:{currentStage:'review'},
      findings:[
        {id:'fin_safe_123',title:'Synthetic finding',status:'open'},
        {id:'../../../secret',title:'Invalid id',status:'open'}
      ],
      evidence:[
        {id:'evi_safe_123',verificationState:'verified',retentionStatus:'active'},
        {id:'../../token',verificationState:'verified',retentionStatus:'active'},
        {id:'evi_unverified_11',verificationState:'unverified',retentionStatus:'active'}
      ]
    }]
  });
  const c=report.controls[0];
  assert.equal(c.findings[0].findingId,'fin_safe_123');
  assert.equal(c.findings[1].findingId,null);
  assert.deepEqual(c.evidence.verifiedActiveIds,['evi_safe_123']);
  assert.equal(c.evidence.verifiedActiveItems,2);
});
