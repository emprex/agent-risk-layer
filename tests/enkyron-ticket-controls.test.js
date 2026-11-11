import assert from 'node:assert/strict';
import {test} from 'node:test';
import {validateControlReviewRequest,recordTicketControlApplicability,prepareTicketSourceReview}
  from '../desktop/enkyron-ticket-controls.mjs';

const ticket='3385aa99-e08a-4471-b8e5-9d0b36a8412b';

test('canonical control review refuses malformed ticket or out-of-register control',()=>{
  for(const bad of ['', 'ARL-KB-000','ARL-KB-109','ARL-KB-999','ARL-KB-1']) {
    assert.throws(()=>validateControlReviewRequest({
      ticket_id:ticket,control_id:bad
    }),/Control review/);
  }
  assert.throws(()=>validateControlReviewRequest({
    ticket_id:'other',control_id:'ARL-KB-001'
  }),/Control review/);
  assert.deepEqual(validateControlReviewRequest({
    ticket_id:ticket,control_id:'ARL-KB-108'
  }),{ticketId:ticket,controlId:'ARL-KB-108'});
});

test('no human applicability write without exact snapshot, digest, facts and confirmation',()=>{
  const valid={
    ticket_id:ticket,control_id:'ARL-KB-001',
    decision:'applicable',reason:'Human confirmed control applies to frozen agent scope.',
    snapshot_id:'sys_a1ea05c78ee64357a4c8a75b47ce4662',
    evaluation_digest:'a'.repeat(64),
    architecture_fact_ids:[],confirmed:true
  };
  assert.deepEqual(validateControlReviewRequest(valid,{decision:true}),
    {ticketId:ticket,controlId:'ARL-KB-001'});
  for(const change of [
    {confirmed:false},{decision:'passed'},{reason:'short'},
    {snapshot_id:'sys_wrong'}, {evaluation_digest:'ab'},
    {architecture_fact_ids:null},
    {decision:'not_applicable'},
    {decision:'context_required',confirmed:null},
  ]){
    assert.throws(()=>validateControlReviewRequest({...valid,...change},{decision:true}),
      /Control review/);
  }
});

test('malformed decision never touches database, even if invoked directly',async()=>{
  const pool={query:()=>{throw new Error('Unexpected database access');}};
  await assert.rejects(recordTicketControlApplicability(pool,{
    ticket_id:ticket,control_id:'ARL-KB-001',decision:'applicable',
    reason:'human decision not yet confirmed',
    snapshot_id:'sys_a1ea05c78ee64357a4c8a75b47ce4662',
    evaluation_digest:'a'.repeat(64),architecture_fact_ids:[],confirmed:false
  },'emprex'),/Control review/);
});

test('existing ARL frozen source inspection prepares candidates without decisions or database writes',async()=>{
  const scope={ticket_id:ticket,project_id:'prj_test',snapshot_id:'sys_test',
    target_sha:'a'.repeat(40),target_reference:'/home/synthetic/agent'};
  let inspections=0,scopeReads=0;
  const inspector=async(repo)=>{
    inspections++;
    assert.equal(repo,scope.target_reference);
    return {
      type:'frozen_inspection',
      target:{revision:scope.target_sha,dirty:false},
      binding:{verified:true,revisionBefore:scope.target_sha,revisionAfter:scope.target_sha},
      inspection:{
        schema:'arl.inspection.bundle.v1',
        scanner:{version:'4.1.5'},
        scope:{mode:'read-only-static-inspection',filesDiscovered:15,
          filesInspected:11,truncatedByLimit:false},
        findings:[{ruleId:'ARL-AI-001',title:'Review execution primitives',
          severity:'high',evidence:[{path:'/private/secret'}]}]
      }
    };
  };
  const scopeReader=async()=>{scopeReads++;return scope;};
  const pool={query:()=>{throw Error('No database query expected from injected scope reader');}};
  const report=await prepareTicketSourceReview(pool,ticket,{inspector,scopeReader});
  assert.equal(inspections,1);
  assert.equal(scopeReads,2);
  assert.equal(report.snapshot_id,scope.snapshot_id);
  assert.equal(report.target_sha,scope.target_sha);
  assert.equal(report.candidate_count,1);
  assert.equal(report.files_inspected,11);
  assert.equal(report.decisions_recorded,0);
  assert.equal(report.tests_executed,0);
  assert.equal(report.security_verdict,false);
  assert.equal(JSON.stringify(report).includes('/private/secret'),false);
});

test('source preparation refuses mismatched SHA and changed assessment',async()=>{
  const scope={project_id:'prj_2',snapshot_id:'sys_2',target_sha:'a'.repeat(40),
    target_reference:'/home/synthetic/agent'};
  const inspected=async()=>({
    type:'frozen_inspection',target:{revision:'b'.repeat(40),dirty:false},
    binding:{verified:true,revisionBefore:'b'.repeat(40),revisionAfter:'b'.repeat(40)},
    inspection:{schema:'arl.inspection.bundle.v1',
      scope:{mode:'read-only-static-inspection'},findings:[]}
  });
  await assert.rejects(prepareTicketSourceReview({},ticket,{
    inspector:inspected,scopeReader:async()=>scope
  }),/exact-SHA binding/);
  const verified=async()=>({
    type:'frozen_inspection',target:{revision:scope.target_sha,dirty:false},
    binding:{verified:true,revisionBefore:scope.target_sha,revisionAfter:scope.target_sha},
    inspection:{schema:'arl.inspection.bundle.v1',
      scope:{mode:'read-only-static-inspection'},findings:[]}
  });
  let calls=0;
  await assert.rejects(prepareTicketSourceReview({},ticket,{
    inspector:verified,
    scopeReader:async()=>({...scope,snapshot_id:++calls===1?'sys_2':'sys_changed'})
  }),/changed while the source was inspected/);
});
