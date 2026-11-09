import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import pg from 'pg';
import {createCompany} from '../desktop/enkyron-crm.mjs';
import {createDeskTicket} from '../desktop/enkyron-ticket-intake.mjs';
import {linkTicketToCompany} from '../desktop/enkyron-crm-tickets.mjs';
import {recordActivity} from '../desktop/enkyron-crm-activities.mjs';
import {
 createDirectCompanyOpportunity,createCompanyOpportunity,correctCommercialOrigin,
 listOpportunities
} from '../desktop/enkyron-crm-opportunities.mjs';
import {getCompanyDossier} from '../desktop/enkyron-crm-company-dossier.mjs';
import {createProposalDraft} from '../desktop/enkyron-crm-proposals.mjs';
import {readProposalForDraftPdf} from '../desktop/enkyron-crm-proposal-export.mjs';
import {readBuyerReview} from '../desktop/enkyron-crm-buyer-review.mjs';
import {readQuoteIssuePreflight} from '../desktop/enkyron-crm-quote-preflight.mjs';
import {readInvoicePreparation} from '../desktop/enkyron-crm-invoice-drafts.mjs';
const url=process.env.ARL_CI_POSTGRES_URL||'';
function isolated(){
 assert.equal(process.env.CI,'true','Only disposable CI PostgreSQL may be written');
 const u=new URL(url);
 assert.equal(u.hostname,'127.0.0.1');
 assert.equal(u.pathname,'/arl_ci');
 assert.equal(u.username,'arl_ci');
 assert.equal(u.password,'synthetic-ci-only');
 return url;
}
test('direct CRM opportunity needs no ticket and appears with correspondence in company dossier',{
 skip:!url&&'CI disposable PostgreSQL only',timeout:45000
},async()=>{
 const pool=new pg.Pool({connectionString:isolated(),max:3});
 const operator='ci-direct-'+randomUUID().slice(0,8);
 try{
  const company=await createCompany(pool,{name:'Synthetic Direct '+randomUUID().slice(0,8)},operator);
  const before=(await pool.query('SELECT count(*)::int AS n FROM arl_workbench_tickets')).rows[0].n;
  const req={company_id:company.id,company_name_at_review:company.name,
   next_action:'Send a manual LinkedIn introduction and record actual outreach',
   due_date:null,confirmed:true};
  const opp=await createDirectCompanyOpportunity(pool,req,operator);
  assert.equal(opp.source_ticket_id,null);
  await assert.rejects(()=>createDirectCompanyOpportunity(pool,req,operator),/already exists/);
  const after=(await pool.query('SELECT count(*)::int AS n FROM arl_workbench_tickets')).rows[0].n;
  assert.equal(after,before,'CRM contact must never create a service ticket');
  const result=(await listOpportunities(pool,company.name,operator)).items.find(x=>x.id===opp.id);
  assert.equal(result.prospect_source,'crm_company_direct');
  assert.equal(result.source_ticket_id,null);
  await recordActivity(pool,{opportunity_id:opp.id,activity_type:'note',
    detail:'LinkedIn introduction composed; NOT SENT; no customer authorisation.',
    reviewed:true},operator);
  const draft=await createProposalDraft(pool,{
    opportunity_id:opp.id,title:'Internal exploratory offer - not accepted',
    scope_text:'Prospective AI agent security assessment, subject to written authorisation.',
    currency:'GBP',amount_minor:50000
  },operator);
  // Commercial documentary steps must not secretly depend on a service ticket.
  const pdf=await readProposalForDraftPdf(pool,draft.id,operator);
  assert.ok(pdf,'commercial PDF draft remains available to the operator');
  const buyer=await readBuyerReview(pool,draft.id,operator);
  assert.equal(buyer.origin_kind,'crm_company_direct');
  const preflight=await readQuoteIssuePreflight(pool,draft.id,operator);
  assert.ok(preflight,'quote preflight must be readable even when incomplete');
  const invoice=await readInvoicePreparation(pool,draft.id,operator);
  assert.equal(invoice.origin_kind,'crm_company_direct');
  assert.equal(invoice.can_prepare,false,'missing documentary gates still block billing');
  const dossier=await getCompanyDossier(pool,company.id,operator);
  assert.ok(dossier.sections.opportunities.items.some(x=>x.opportunity_id===opp.id));
  assert.ok(dossier.sections.activities.items.some(x=>x.detail.includes('NOT SENT')));
  assert.ok(dossier.sections.commercial_docs.items.some(x=>x.proposal_id===draft.id));
  await assert.rejects(
   ()=>getCompanyDossier(pool,company.id,'another-operator'),
   /company not found in local workspace/
  );
 }finally{await pool.end();}
});
test('reviewed correction detaches only known accidental LinkedIn ticket and preserves audit',{
 skip:!url&&'CI disposable PostgreSQL only',timeout:45000
},async()=>{
 const pool=new pg.Pool({connectionString:isolated(),max:3});
 const operator='ci-correction-'+randomUUID().slice(0,8);
 try{
  const company=await createCompany(pool,{name:'Threat ResQ'},operator);
  const ticket=await createDeskTicket(pool,{
   source:'manual',client_name:'Threat ResQ',
   title:'Partnership enquiry - Threat ResQ - LinkedIn - 2026-11-09',
   request_text:'Internal outbound sales lead recorded in error as a customer service request.'
  },operator);
  await linkTicketToCompany(pool,{company_id:company.id,ticket_id:ticket.id,
   ticket_client_name_at_review:'Threat ResQ',reviewed:true,
   review_note:'Manual reconciliation of CRM company and mistakenly created outreach ticket.'
  },operator);
  const opp=await createCompanyOpportunity(pool,{
   company_id:company.id,ticket_id:ticket.id,
   company_name_at_review:'Threat ResQ',
   ticket_number_at_review:ticket.ticket_number,
   next_action:'Await email response from commercial prospect',
   due_date:null,confirmed:true
  },operator);
  const note=await recordActivity(pool,{
   opportunity_id:opp.id,activity_type:'note',
   detail:'Operator reports LinkedIn outreach was sent, not independently verified.',
   reviewed:true
  },operator);
  const initialTicket=(await pool.query('SELECT * FROM arl_workbench_tickets WHERE id=$1',
   [ticket.id])).rows[0];
  const request={company_id:company.id,opportunity_id:opp.id,ticket_id:ticket.id,
   ticket_number_at_review:ticket.ticket_number,company_name_at_review:'Threat ResQ',
   reason:'The recorded LinkedIn contact was a sales outreach, not an actual customer service request.',
   confirmed:true};
  const corrected=await correctCommercialOrigin(pool,request,operator);
  assert.equal(corrected.source_ticket_id,null);
  assert.equal(corrected.id,opp.id);
  assert.equal(corrected.version,opp.version+1);
  const now=(await pool.query(
   'SELECT prospect_id,company_id,source_ticket_id FROM enkyron_crm_opportunities WHERE id=$1',
   [opp.id])).rows[0];
  assert.deepEqual(now,{prospect_id:null,company_id:company.id,source_ticket_id:null});
  const initialNote=(await pool.query('SELECT detail FROM enkyron_crm_activities WHERE id=$1',
   [note.id])).rows[0].detail;
  assert.match(initialNote,/LinkedIn outreach/);
  const latestTicket=(await pool.query('SELECT * FROM arl_workbench_tickets WHERE id=$1',
   [ticket.id])).rows[0];
  assert.deepEqual(latestTicket,initialTicket,'original service record is never rewritten');
  const audits=(await pool.query(
   'SELECT * FROM enkyron_crm_opportunity_origin_corrections WHERE opportunity_id=$1',
   [opp.id])).rows;
  assert.equal(audits.length,1);
  assert.equal(audits[0].old_source_ticket_id,ticket.id);
  await assert.rejects(()=>correctCommercialOrigin(pool,request,operator),/source changed/);
  await assert.rejects(()=>createCompanyOpportunity(pool,{
   company_id:company.id,ticket_id:ticket.id,company_name_at_review:'Threat ResQ',
   ticket_number_at_review:ticket.ticket_number,
   next_action:'Recreate by mistake',due_date:null,confirmed:true
  },operator),/corrected commercial ticket/);
  const dossier=await getCompanyDossier(pool,company.id,operator);
  assert.ok(dossier.sections.opportunities.items.some(x=>x.opportunity_id===opp.id));
  assert.ok(dossier.sections.activities.items.some(x=>x.id===note.id));
  assert.equal(dossier.sections.tickets.total,0,
    'revoked prospecting intake must not masquerade as a company service ticket');
  const revocation=(await pool.query(
   'SELECT id FROM enkyron_crm_ticket_link_revocations WHERE workspace_key=$1 AND ticket_id=$2',
   ['local:'+operator,ticket.id])).rows;
  assert.equal(revocation.length,1);
  await assert.rejects(()=>pool.query(
   'DELETE FROM enkyron_crm_opportunity_origin_corrections WHERE opportunity_id=$1',
   [opp.id]
  ),/cannot be changed or deleted/);
 }finally{await pool.end();}
});
