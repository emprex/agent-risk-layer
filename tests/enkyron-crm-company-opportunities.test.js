import test from 'node:test';
import assert from 'node:assert/strict';
import {validateCompanyOpportunityCreate} from '../desktop/enkyron-crm-opportunities.mjs';

const valid={
  company_id:'11111111-2222-4333-8444-555555555555',
  ticket_id:'22222222-3333-4444-8555-666666666666',
  company_name_at_review:'Synthetic Company',
  ticket_number_at_review:'ARL-2026-000005',
  next_action:'Review the scope before preparing any proposal',
  due_date:null,confirmed:true
};
test('company-first sales opportunity is explicit and source-linked',()=>{
  assert.deepEqual(validateCompanyOpportunityCreate(valid),{
    company_id:valid.company_id,ticket_id:valid.ticket_id,
    company_name_at_review:valid.company_name_at_review,
    ticket_number_at_review:valid.ticket_number_at_review,
    next_action:valid.next_action,due_date:null
  });
  for(const broken of [
    {...valid,confirmed:false},{...valid,company_id:'wrong'},
    {...valid,ticket_id:'wrong'}, {...valid,company_name_at_review:' '},
    {...valid,ticket_number_at_review:'x'},{...valid,next_action:'hi'},
    {...valid,due_date:'2026-02-30'},{...valid,unknown:'yes'},
    {...valid,prospect_id:'fake-prospect'}, {...valid,next_action:'bad\nline'}
  ])assert.throws(()=>validateCompanyOpportunityCreate(broken),/CRM|ticket/i);
});
