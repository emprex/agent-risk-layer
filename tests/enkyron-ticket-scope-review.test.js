import assert from 'node:assert/strict';
import {test} from 'node:test';
import {validateScopeReview,readTicketScopeReview,recordTicketScopeReview}
  from '../desktop/enkyron-ticket-scope-review.mjs';

const ticket='3385aa99-e08a-4471-b8e5-9d0b36a8412b';
const sha='129a20f42321742229ba78c3f1b13ea925ea7622';
const scope={available:true,project_id:'prj_scope_synthetic',
  assessment_id:'asm_scope_synthetic',
  snapshot_id:'sys_scope_synthetic',target_sha:sha,
  target_reference:'/home/synthetic/git-target'};
const ticketRow={id:ticket,assigned_to:'emprex',assessor_name:'emprex',
  status:'scoping',archived_at:null,target_kind:'git',
  linked_project_id:scope.project_id,linked_assessment_id:scope.assessment_id,
  target_reference:scope.target_reference};
const request={ticket_id:ticket,snapshot_id:scope.snapshot_id,target_sha:sha,
  expected_revision:0,decision:'scope_draft',
  technical_owner:'Internal laboratory owner',
  owner_authority_basis:'The laboratory owner is responsible for controlling the pilot repository.',
  included_scope:'Local Git snapshot, source metadata and read-only static inspection only.',
  excluded_scope:'Production services, external endpoints and all unmanaged third-party targets.',
  environment:'Isolated internal laboratory',
  permitted_methods:'Read-only repository review, documentation review and source inventory.',
  prohibited_methods:'No live network traffic, credential access, exploitation or destructive tests.',
  rules_of_engagement:'Stop on any repository revision change, scope mismatch or unverified permission; no production tests.',
  owner_permission_reference:'',rationale:'Documenting exact review scope without claiming permission for live execution.',
  confirmed:true
};

test('requires exact snapshot, operator confirmation and bounded ROE',()=>{
  assert.equal(validateScopeReview(request).decision,'scope_draft');
  for(const wrong of [
    {confirmed:false},{snapshot_id:'bad'},{target_sha:'a'},
    {expected_revision:-1},{decision:'approved_active_tests'},
    {rules_of_engagement:'too short'},
    {included_scope:''},{extra_permission:true}
  ])assert.throws(()=>validateScopeReview({...request,...wrong}));
  assert.throws(()=>validateScopeReview({
    ...request,decision:'active_test_authorisation_pending'
  }),/permission reference/);
  const pending=validateScopeReview({...request,
    decision:'active_test_authorisation_pending',
    owner_permission_reference:'INTERNAL-LAB-ROE-001'});
  assert.equal(pending.decision,'active_test_authorisation_pending');
});

test('read-only scope history is bound to exact ticket and flags snapshot drift',async()=>{
  const calls=[];
  const pool={query:async(sql,args)=>{
    calls.push({sql,args});
    if(sql.includes('FROM arl_workbench_tickets'))return{rows:[ticketRow]};
    if(sql.includes('FROM enkyron_ticket_scope_reviews'))return{rows:[{
      ticket_id:ticket,revision:2,project_id:scope.project_id,
      assessment_id:scope.assessment_id,system_snapshot_id:'sys_old',
      target_sha:sha,decision:'scope_draft'
    }]};
    throw Error('unexpected query');
  }};
  const result=await readTicketScopeReview(pool,ticket,'emprex',{
    scopeReader:async()=>scope
  });
  assert.equal(result.available,true);
  assert.equal(result.current_revision_binding,false);
  assert.equal(result.tests_authorised,false);
  assert.ok(calls.every(x=>x.sql.startsWith('SELECT')));
  await assert.rejects(readTicketScopeReview(pool,ticket,'outsider',{
    scopeReader:async()=>scope
  }),/assigned local operator/);
});

test('review fails closed when migration is missing',async()=>{
  const pool={query:async(sql)=>{
    if(sql.includes('FROM arl_workbench_tickets'))return {rows:[ticketRow]};
    const error=Error('missing table');
    error.code='42P01';
    throw error;
  }};
  const result=await readTicketScopeReview(pool,ticket,'emprex',{
    scopeReader:async()=>scope
  });
  assert.equal(result.available,false);
  assert.equal(result.tests_authorised,false);
  assert.match(result.notice,/114/);
});

test('no permission or scope row is written for invalid confirmation',async()=>{
  const pool={query:async()=>{throw Error('unexpected DB access');}};
  await assert.rejects(recordTicketScopeReview(pool,{
    ...request,confirmed:false
  },'emprex',{scopeReader:async()=>scope}),/confirmation/);
  await assert.rejects(recordTicketScopeReview(pool,{
    ...request,target_sha:'f'.repeat(40)
  },'emprex',{scopeReader:async()=>scope}),/changed since review/);
});
