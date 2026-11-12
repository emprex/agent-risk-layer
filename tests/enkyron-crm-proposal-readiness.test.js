import test from 'node:test';
import assert from 'node:assert/strict';
import {
  INTERNAL_DRAFT_STAGES, validateCompanyProposalReadinessRequest,
  assessCompanyProposalReadiness, getCompanyProposalReadiness
} from '../desktop/enkyron-crm-proposal-readiness.mjs';

const COMPANY='11111111-2222-4333-8444-555555555555';
const OPPORTUNITY='22222222-3333-4444-8555-666666666666';
const REVIEW='33333333-4444-4555-8666-777777777777';
const ids=COMPANY+':'+OPPORTUNITY;
const opportunity={id:OPPORTUNITY,company_id:COMPANY,stage:'qualified',version:2,
  next_action:'Arrange synthetic internal discovery',due_date:'2026-11-16'};
const qualification={id:REVIEW,fit_status:'potential_fit',priority:'normal',
  recorded_by:'ci-operator',recorded_at:'2026-11-12T22:54:58Z'};

test('request demands two immutable canonical UUIDs, no names or arbitrary queries',()=>{
  assert.deepEqual(validateCompanyProposalReadinessRequest(ids),{
    company_id:COMPANY,opportunity_id:OPPORTUNITY
  });
  for(const bad of [null,'',COMPANY,COMPANY+':bad',COMPANY+':'+OPPORTUNITY+':x',
    'example-client:'+OPPORTUNITY,ids.toUpperCase(),'../../data']){
    assert.throws(()=>validateCompanyProposalReadinessRequest(bad),/CRM invalid/);
  }
});

test('readiness is advisory, qualified and potential-fit only, never issue authority',()=>{
  assert.deepEqual(INTERNAL_DRAFT_STAGES,[
    'qualified','contact_planned','contacted','discovery','proposal','negotiation'
  ]);
  const accepted=assessCompanyProposalReadiness({
    opportunity,qualification,draft_count:0
  });
  assert.equal(accepted.eligible_for_internal_draft_review,true);
  assert.equal(accepted.external_issue_authorised,false);
  assert.deepEqual(accepted.blockers,[]);
  for(const caseData of [
    {opportunity:{...opportunity,stage:'research'},qualification,draft_count:0},
    {opportunity:{...opportunity,stage:'lost'},qualification,draft_count:0},
    {opportunity:null,qualification,draft_count:0},
    {opportunity,qualification:null,draft_count:0},
    {opportunity,qualification:{...qualification,fit_status:'not_fit'},draft_count:0},
    {opportunity,qualification,draft_count:1},
  ]){
    const outcome=assessCompanyProposalReadiness(caseData);
    assert.equal(outcome.eligible_for_internal_draft_review,false);
    assert.ok(outcome.blockers.length>0);
    assert.equal(outcome.external_issue_authorised,false);
  }
  for(const draft_count of [-1,3.5,'0'])
    assert.throws(()=>assessCompanyProposalReadiness({
      opportunity,qualification,draft_count
    }),/invalid proposal draft count/);
});

test('single repeatable-read SQL snapshot scopes exact company, direct opportunity, review and drafts',async()=>{
  const calls=[],release=[];
  const pool={connect:async()=>({
    query:async(sql,params)=>{
      calls.push({sql,params});
      if(sql.includes('FROM enkyron_crm_companies'))
        return {rows:[{id:COMPANY,name:'Synthetic Engineering Ltd'}]};
      if(sql.includes('FROM enkyron_crm_opportunities'))
        return {rows:[opportunity]};
      if(sql.includes('FROM enkyron_crm_qualification_reviews'))
        return {rows:[qualification]};
      if(sql.includes('FROM enkyron_crm_proposal_drafts'))
        return {rows:[{draft_count:0}]};
      return {rows:[]};
    },
    release:()=>release.push(true)
  })};
  const result=await getCompanyProposalReadiness(pool,ids,'ci-operator');
  assert.equal(result.available,true);
  assert.equal(result.company_id,COMPANY);
  assert.equal(result.opportunity_id,OPPORTUNITY);
  assert.equal(result.eligible_for_internal_draft_review,true);
  assert.equal(result.external_issue_authorised,false);
  assert.deepEqual(calls.map(x=>x.sql.split(' ')[0]),[
    'BEGIN','SELECT','SELECT','SELECT','SELECT','COMMIT'
  ]);
  assert.match(calls[0].sql,/REPEATABLE READ READ ONLY/);
  assert.deepEqual(calls[1].params,['local:ci-operator',COMPANY]);
  assert.deepEqual(calls[2].params,['local:ci-operator',OPPORTUNITY,COMPANY]);
  assert.match(calls[2].sql,/source_ticket_id IS NULL/);
  assert.deepEqual(calls[3].params,['local:ci-operator',COMPANY]);
  assert.match(calls[3].sql,/contact_id IS NULL/);
  assert.deepEqual(calls[4].params,['local:ci-operator',OPPORTUNITY]);
  assert.equal(release.length,1);
  assert.equal(calls.filter(x=>/^INSERT|^UPDATE|^DELETE/.test(x.sql)).length,0);
});

test('wrong-company opportunity cannot appear ready; read failure rolls back',async()=>{
  const sqls=[];
  const db={connect:async()=>({
    query:async(sql)=>{
      sqls.push(sql);
      if(sql.includes('FROM enkyron_crm_companies'))return {rows:[{id:COMPANY,name:'A'}]};
      if(sql.includes('FROM enkyron_crm_opportunities'))return {rows:[]};
      if(sql.includes('FROM enkyron_crm_qualification_reviews'))return {rows:[qualification]};
      if(sql.includes('FROM enkyron_crm_proposal_drafts'))return {rows:[{draft_count:0}]};
      return {rows:[]};
    },release:()=>{}
  })};
  const missing=await getCompanyProposalReadiness(db,ids,'ci-operator');
  assert.equal(missing.eligible_for_internal_draft_review,false);
  assert.ok(missing.blockers.some(x=>x.includes('not directly linked')));
  assert.equal(missing.external_issue_authorised,false);

  const rollback=[];
  const failing={connect:async()=>({
    query:async(sql)=>{
      rollback.push(sql);
      if(sql.includes('FROM enkyron_crm_companies'))throw Error('DB read error');
      return {rows:[]};
    },release:()=>{}
  })};
  await assert.rejects(()=>getCompanyProposalReadiness(failing,ids,'ci-operator'),
    /DB read error/);
  assert.equal(rollback.at(-1),'ROLLBACK');
  await assert.rejects(()=>getCompanyProposalReadiness(db,ids,'bad/actor'),
    /invalid local operator/);
});
