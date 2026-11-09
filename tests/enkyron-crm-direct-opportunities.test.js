import test from 'node:test';
import assert from 'node:assert/strict';
import {
 validateDirectCompanyOpportunityCreate, validateOriginCorrection
} from '../desktop/enkyron-crm-opportunities.mjs';

const company='00000000-0000-4000-8000-000000000001';
const opportunity='00000000-0000-4000-8000-000000000002';
const ticket='00000000-0000-4000-8000-000000000003';
const direct={
 company_id:company,company_name_at_review:'Xurrent',
 next_action:'Review the CTO public post and prepare a written introduction',
 due_date:null,confirmed:true
};
test('CRM direct opportunities require reviewed company and never accept a ticket',()=>{
 assert.deepEqual(validateDirectCompanyOpportunityCreate(direct),{
  company_id:company,company_name_at_review:'Xurrent',
  next_action:direct.next_action,due_date:null
 });
 assert.throws(()=>validateDirectCompanyOpportunityCreate({...direct,confirmed:false}),/review/);
 assert.throws(()=>validateDirectCompanyOpportunityCreate({...direct,ticket_id:ticket}),/invalid/);
 assert.throws(()=>validateDirectCompanyOpportunityCreate({...direct,company_name_at_review:'Wrong\nName'}),/company/);
});
test('historical origin correction requires all reviewed identifiers and a reason',()=>{
 const req={company_id:company,opportunity_id:opportunity,ticket_id:ticket,
  ticket_number_at_review:'ARL-2026-000007',
  company_name_at_review:'Xurrent',
  reason:'The source ticket was an internal prospecting outreach, not a customer request.',
  confirmed:true};
 assert.equal(validateOriginCorrection(req).opportunity_id,opportunity);
 assert.throws(()=>validateOriginCorrection({...req,confirmed:false}),/confirmation/);
 assert.throws(()=>validateOriginCorrection({...req,reason:'too short'}),/reason/);
 assert.throws(()=>validateOriginCorrection({...req,opportunity_id:'bad'}),/identifier/);
});
