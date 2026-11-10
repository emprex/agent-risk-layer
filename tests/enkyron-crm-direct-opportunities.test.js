import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const requireFile=(relative)=>readFileSync(new URL(relative,import.meta.url),'utf8');
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

// Regression for operator's local correction script. The canonical view in
// migration 091 deliberately does NOT project an id column.
test('outreach local repair checks effective link existence without selecting absent id',()=>{
 const sql=readFileSync(new URL('../migrations/091_enkyron_crm_ticket_reassignments.sql',
   import.meta.url),'utf8');
 assert.match(sql,/CREATE VIEW enkyron_crm_effective_ticket_links AS/i);
 const view=sql.split('CREATE VIEW enkyron_crm_effective_ticket_links AS')[1];
 assert.doesNotMatch(view,/SELECT l\.id\b/);
 const script=readFileSync(new URL('../scripts/enkyron-fix-outreach-local.mjs',
   import.meta.url),'utf8');
 assert.match(script,/SELECT 1 FROM enkyron_crm_effective_ticket_links /);
 assert.doesNotMatch(script,/SELECT id FROM enkyron_crm_effective_ticket_links /);
});

test('false-ticket removal is restricted to two synthetic intakes and preserves commercial messages',()=>{
 const fs=requireFile('../scripts/enkyron-remove-false-tickets-local.mjs');
 assert.match(fs,/ARL-2026-000006/);
 assert.match(fs,/ARL-2026-000007/);
 assert.match(fs,/enkyron-before-false-ticket-removal-/);
 assert.match(fs,/pg_restore/);
 assert.match(fs,/BEGIN/);
 assert.match(fs,/ROLLBACK/);
 assert.match(fs,/COMMIT/);
 assert.match(fs,/DELETE FROM arl_workbench_tickets WHERE id=\$1/);
 assert.doesNotMatch(fs,/DELETE FROM enkyron_crm_activities/);
 assert.doesNotMatch(fs,/DELETE FROM enkyron_crm_opportunities/);
});
