import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import pg from 'pg';
import {createOpportunity} from '../desktop/enkyron-crm-opportunities.mjs';
import {createProposalDraft} from '../desktop/enkyron-crm-proposals.mjs';
import {replaceProposalLines} from '../desktop/enkyron-crm-proposal-lines.mjs';
import {readProposalForDraftPdf} from '../desktop/enkyron-crm-proposal-export.mjs';

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
    const pdf=await readProposalForDraftPdf(db,created.id,actor);
    assert.equal(pdf.available,true);
    assert.equal(pdf.proposal.id,created.id);
    assert.equal(pdf.proposal.revision,2);
    assert.equal(pdf.proposal.research_candidate,'Research candidate - UNVERIFIED');
    assert.equal(pdf.proposal.currency,'GBP');
    assert.equal(pdf.proposal.amount_minor,50100);
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
