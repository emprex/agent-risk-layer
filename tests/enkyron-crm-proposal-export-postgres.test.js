import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import pg from 'pg';
import {createOpportunity} from '../desktop/enkyron-crm-opportunities.mjs';
import {createProposalDraft} from '../desktop/enkyron-crm-proposals.mjs';
import {replaceProposalLines} from '../desktop/enkyron-crm-proposal-lines.mjs';
import {readProposalForDraftPdf} from '../desktop/enkyron-crm-proposal-export.mjs';
import {recordCompanyProfile} from '../desktop/enkyron-company-profile.mjs';
import {createCompany} from '../desktop/enkyron-crm.mjs';
import {createDeskTicket} from '../desktop/enkyron-ticket-intake.mjs';
import {linkTicketToCompany} from '../desktop/enkyron-crm-tickets.mjs';
import {revokeTicketAssociation} from '../desktop/enkyron-crm-ticket-corrections.mjs';
import {createCompanyOpportunity} from '../desktop/enkyron-crm-opportunities.mjs';

const uri=process.env.ARL_CI_POSTGRES_URL||'';
function isolated(){
  assert.equal(process.env.CI,'true','Disposable CI PostgreSQL only');
  const url=new URL(uri);
  assert.equal(url.hostname,'127.0.0.1');
  assert.equal(url.pathname,'/arl_ci');
  assert.equal(url.username,'arl_ci');
  assert.equal(url.password,'synthetic-ci-only');
  return uri;
}
test('PostgreSQL PDF snapshot reads saved proposal lines and does not change commercial sources', {
  skip:!uri&&'Isolated PostgreSQL CI only',timeout:60000
},async()=>{
  const db=new pg.Pool({connectionString:isolated(),max:3});
  const actor='ci-pdf-'+randomUUID().slice(0,8);
  try{
    const uid='usr_pdf_'+randomUUID(),lead='lead_pdf_'+randomUUID();
    await db.query('INSERT INTO users(id,email,password_hash,created_at) VALUES($1,$2,$3,NOW())',
      [uid,'ci-pdf-'+randomUUID()+'@example.invalid','synthetic']);
    await db.query('INSERT INTO sales_prospects '
      +'(id,company_name,source,created_by,created_at,updated_at) '
      +'VALUES($1,$2,$3,$4,NOW(),NOW())',
      [lead,'Research candidate - UNVERIFIED','synthetic-ci',uid]);
    const opportunity=await createOpportunity(db,{
      prospect_id:lead,company_name_at_review:'Research candidate - UNVERIFIED',
      next_action:'Draft a proposal for review by the operator',
      due_date:'2026-11-20'
    },actor);
    const created=await createProposalDraft(db,{
      opportunity_id:opportunity.id,title:'Agentic workflow security - draft',
      scope_text:'Manual scope to be confirmed. No engagement has been authorised or initiated.',
      currency:'GBP',amount_minor:100000
    },actor);
    const itemized=await replaceProposalLines(db,{
      proposal_id:created.id,expected_revision:1,lines:[
        {description:'Manual scope discovery',quantity:2,unit_price_minor:10025},
        {description:'Proposed evidence review',quantity:1,unit_price_minor:30050}
      ]
    },actor);
    assert.equal(itemized.revision,2);
    const before=(await Promise.all([
      db.query('SELECT count(*)::int AS n FROM sales_messages'),
      db.query('SELECT count(*)::int AS n FROM enkyron_crm_proposal_draft_events '
        +'WHERE workspace_key=$1 AND proposal_id=$2',['local:'+actor,created.id]),
      db.query('SELECT count(*)::int AS n FROM enkyron_crm_proposal_line_versions '
        +'WHERE workspace_key=$1 AND proposal_id=$2',['local:'+actor,created.id]),
      db.query('SELECT * FROM enkyron_crm_opportunities WHERE id=$1',[opportunity.id])
    ])).map(x=>x.rows[0]);
    const profile=await recordCompanyProfile(db,{
      expected_revision:0,confirmed:true,legal_name:'Synthetic Issuer Ltd',
      registration_number:'00000000',incorporation_country:'GB',
      registered_office:'10 Synthetic Avenue, Testing, EX1 1AB',
      vat_status:'unknown',default_currency:'GBP',
      company_utr:'0123456789',tax_office_number:'001',
      source_reference:'Synthetic fixture only',
      verification_notes:'Test-only issuer identity without documentary verification.'
    },actor);
    assert.equal(profile.revision,1);
    const pdf=await readProposalForDraftPdf(db,created.id,actor);
    assert.equal(pdf.available,true);
    assert.equal(pdf.proposal.id,created.id);
    assert.equal(pdf.proposal.revision,2);
    assert.equal(pdf.proposal.research_candidate,'Research candidate - UNVERIFIED');
    assert.equal(pdf.proposal.buyer_origin,'research_candidate');
    assert.equal(pdf.proposal.currency,'GBP');
    assert.equal(pdf.proposal.amount_minor,50100);
    assert.deepEqual(pdf.proposal.issuer,{
      legal_name:'Synthetic Issuer Ltd',registration_number:'00000000',
      registered_office:'10 Synthetic Avenue, Testing, EX1 1AB',
      revision:1,verification_status:'operator_entered_unverified'
    });
    assert.doesNotMatch(JSON.stringify(pdf),/0123456789|tax_office_number|company_utr/);
    assert.deepEqual(pdf.proposal.lines.map(x=>[x.quantity,x.unit_price_minor,x.line_total_minor]),[
      [2,10025,20050],[1,30050,30050]
    ]);
    await assert.rejects(()=>readProposalForDraftPdf(db,created.id,'ci-unrelated'),
      /not found in local workspace/);
    const after=(await Promise.all([
      db.query('SELECT count(*)::int AS n FROM sales_messages'),
      db.query('SELECT count(*)::int AS n FROM enkyron_crm_proposal_draft_events '
        +'WHERE workspace_key=$1 AND proposal_id=$2',['local:'+actor,created.id]),
      db.query('SELECT count(*)::int AS n FROM enkyron_crm_proposal_line_versions '
        +'WHERE workspace_key=$1 AND proposal_id=$2',['local:'+actor,created.id]),
      db.query('SELECT * FROM enkyron_crm_opportunities WHERE id=$1',[opportunity.id])
    ])).map(x=>x.rows[0]);
    assert.deepEqual(after,before,'Read-only draft export must not send or mutate CRM records');
  }finally{await db.end();}
});

test('PDF snapshot identifies CRM-company buyer source without legal-identity promotion', {
  skip:!uri&&'Isolated PostgreSQL CI only',timeout:60000
},async()=>{
  const db=new pg.Pool({connectionString:isolated(),max:3});
  const actor='ci-pdf-company-'+randomUUID().slice(0,6);
  const name='Synthetic CRM Company '+randomUUID().slice(0,6);
  try{
    const company=await createCompany(db,{name},actor);
    const ticket=await createDeskTicket(db,{
      source:'manual',client_name:name,title:'Synthetic requested service',
      request_text:'Internal synthetic scoping proposal; no authorised security testing.'
    },actor);
    await linkTicketToCompany(db,{
      company_id:company.id,ticket_id:ticket.id,
      ticket_client_name_at_review:name,
      review_note:'CI-only operator verified synthetic company and ticket association.',
      reviewed:true
    },actor);
    const opportunity=await createCompanyOpportunity(db,{
      company_id:company.id,ticket_id:ticket.id,
      company_name_at_review:name,ticket_number_at_review:ticket.ticket_number,
      next_action:'Prepare safe test quotation draft',due_date:null,confirmed:true
    },actor);
    const proposal=await createProposalDraft(db,{
      opportunity_id:opportunity.id,title:'Scoping review internal draft',
      scope_text:'**Objective**\n\n- Review the supplied documents only.',
      currency:'GBP',amount_minor:75000
    },actor);
    const result=await readProposalForDraftPdf(db,proposal.id,actor);
    assert.equal(result.proposal.buyer_origin,'crm_company');
    assert.equal(result.proposal.research_candidate,name);
    assert.equal(result.proposal.amount_minor,75000);
    assert.deepEqual(result.proposal.lines,[]);
    assert.equal(result.proposal.issuer,null);
    // Revoking the ticket/company source must also block a freshly exported
    // DRAFT PDF; the historical proposal remains unchanged in PostgreSQL.
    await revokeTicketAssociation(db,{
      company_id:company.id,ticket_id:ticket.id,
      expected_client_name:name,
      review_note:'CI synthetic revocation: historical buyer label must not be exported as currently reviewed.',
      confirmed:true
    },actor);
    await assert.rejects(()=>readProposalForDraftPdf(db,proposal.id,actor),
      /company-ticket association is no longer effective/);
    const unchanged=(await db.query(
      'SELECT revision,currency,amount_minor FROM enkyron_crm_proposal_drafts '
      +'WHERE workspace_key=$1 AND id=$2',['local:'+actor,proposal.id])).rows[0];
    assert.equal(unchanged.revision,1);
    assert.equal(unchanged.currency,'GBP');
    assert.equal(Number(unchanged.amount_minor),75000);
    assert.equal((await db.query(
      'SELECT source_ticket_id FROM enkyron_crm_opportunities WHERE id=$1',
      [opportunity.id]
    )).rows[0].source_ticket_id,ticket.id);
  }finally{await db.end();}
});
