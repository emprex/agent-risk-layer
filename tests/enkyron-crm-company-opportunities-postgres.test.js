import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import pg from 'pg';
import {createCompany} from '../desktop/enkyron-crm.mjs';
import {createDeskTicket} from '../desktop/enkyron-ticket-intake.mjs';
import {linkTicketToCompany} from '../desktop/enkyron-crm-tickets.mjs';
import {
  createCompanyOpportunity,listOpportunities,updateOpportunity
} from '../desktop/enkyron-crm-opportunities.mjs';
import {getCompanyDossier} from '../desktop/enkyron-crm-company-dossier.mjs';
import {createProposalDraft} from '../desktop/enkyron-crm-proposals.mjs';

const url=process.env.ARL_CI_POSTGRES_URL||'';
function disposable(){
  assert.equal(process.env.CI,'true','Disposable GitHub PostgreSQL only');
  const u=new URL(url);
  assert.equal(u.hostname,'127.0.0.1');
  assert.equal(u.pathname,'/arl_ci');
  assert.equal(u.username,'arl_ci');
  assert.equal(u.password,'synthetic-ci-only');
  return url;
}
test('E07 company-first: reviewed company-ticket -> opportunity -> internal proposal draft', {
  skip:!url&&'CI disposable PostgreSQL only',timeout:45_000
},async()=>{
  const pool=new pg.Pool({connectionString:disposable(),max:3});
  const actor='ci-company-sales-'+randomUUID().slice(0,6);
  const companyName='CI Company First '+randomUUID().slice(0,8);
  try{
    const company=await createCompany(pool,{name:companyName},actor);
    const twin=await createCompany(pool,{name:companyName+' Alternate'},actor);
    const ticket=await createDeskTicket(pool,{
      source:'manual',client_name:companyName,title:'CI commercial request',
      request_text:'Synthetic customer requests an internal proposal draft, not testing.'
    },actor);
    const request={
      company_id:company.id,ticket_id:ticket.id,company_name_at_review:companyName,
      ticket_number_at_review:ticket.ticket_number,
      next_action:'Review agreed scope and prepare an internal proposal',
      due_date:null,confirmed:true
    };
    const prospectBefore=(await pool.query(
      'SELECT count(*)::int AS n FROM sales_prospects'
    )).rows[0].n;
    await assert.rejects(
      ()=>createCompanyOpportunity(pool,request,actor),/association not currently reviewed/
    );
    await linkTicketToCompany(pool,{
      company_id:company.id,ticket_id:ticket.id,
      ticket_client_name_at_review:companyName,
      review_note:'Operator confirmed synthetic business identity and ticket relationship.',
      reviewed:true
    },actor);
    await assert.rejects(
      ()=>createCompanyOpportunity(pool,{...request,company_id:twin.id},actor),
      /company-ticket association not currently reviewed/
    );
    await assert.rejects(
      ()=>createCompanyOpportunity(pool,{...request,company_name_at_review:'Old name'},actor),
      /identity changed/
    );
    const created=await createCompanyOpportunity(pool,request,actor);
    assert.equal(created.company_id,company.id);
    assert.equal(created.source_ticket_id,ticket.id);
    assert.equal(created.prospect_id,null);
    assert.equal(created.stage,'research');
    await assert.rejects(
      ()=>createCompanyOpportunity(pool,request,actor),/already exists/
    );
    const current=(await listOpportunities(pool,companyName,actor)).items;
    assert.equal(current.filter(x=>x.id===created.id).length,1);
    assert.equal(current.find(x=>x.id===created.id).prospect_source,'reviewed_company_ticket');
    assert.equal((await listOpportunities(pool,companyName,'ci-another-operator')).items
      .filter(x=>x.id===created.id).length,0);
    const qualified=await updateOpportunity(pool,{
      id:created.id,expected_version:1,stage:'qualified',
      next_action:'Prepare scoped draft for human review',due_date:null
    },actor);
    assert.equal(qualified.version,2);
    const quote=await createProposalDraft(pool,{
      opportunity_id:created.id,
      title:'Synthetic security consultation — draft only',
      scope_text:'Internal synthetic proposal for planning and review; not customer acceptance.',
      currency:'GBP',amount_minor:25000
    },actor);
    assert.equal(quote.opportunity_id,created.id);
    const dossier=await getCompanyDossier(pool,company.id,actor);
    assert.equal(dossier.sections.opportunities.total,1);
    assert.equal(dossier.sections.opportunities.items[0].source_ticket_id,ticket.id);
    assert.equal(dossier.sections.commercial_docs.total,1);
    assert.equal(dossier.sections.commercial_docs.items[0].proposal_id,quote.id);
    const unrelated=await getCompanyDossier(pool,twin.id,actor);
    assert.equal(unrelated.sections.opportunities.total,0);
    assert.equal(unrelated.sections.commercial_docs.total,0);
    assert.equal((await pool.query(
      'SELECT count(*)::int AS n FROM sales_prospects'
    )).rows[0].n,prospectBefore);
    const original=(await pool.query(
      'SELECT status,linked_project_id,linked_assessment_id FROM arl_workbench_tickets '
      +'WHERE id=$1',[ticket.id]
    )).rows[0];
    assert.equal(original.status,'new');
    assert.equal(original.linked_project_id,null);
    assert.equal(original.linked_assessment_id,null);
    const source=(await pool.query(
      'SELECT prospect_id,company_id,source_ticket_id '
      +'FROM enkyron_crm_opportunities WHERE id=$1',[created.id]
    )).rows[0];
    assert.deepEqual(source,{
      prospect_id:null,company_id:company.id,source_ticket_id:ticket.id
    });
  }finally{await pool.end();}
});
