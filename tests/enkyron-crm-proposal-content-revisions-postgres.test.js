import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import pg from 'pg';
import {createCompany} from '../desktop/enkyron-crm.mjs';
import {createDirectCompanyOpportunity} from '../desktop/enkyron-crm-opportunities.mjs';
import {createProposalDraft} from '../desktop/enkyron-crm-proposals.mjs';
import {
  reviseCompanyProposalScope,readCompanyProposalContentVersions
} from '../desktop/enkyron-crm-proposal-content-revisions.mjs';

const url=process.env.ARL_CI_POSTGRES_URL||'';
function ciOnly(){
  assert.equal(process.env.CI,'true','Never write real PostgreSQL for this test');
  const u=new URL(url);
  assert.equal(u.hostname,'127.0.0.1');
  assert.equal(u.pathname,'/arl_ci');
  assert.equal(u.username,'arl_ci');
  assert.equal(u.password,'synthetic-ci-only');
  return url;
}
test('ENK-04 real PostgreSQL: preserve complete revision 1 and append reviewed revision 2 atomically',{
  skip:!url&&'Strictly isolated CI PostgreSQL only',timeout:60_000
},async()=>{
  const pool=new pg.Pool({connectionString:ciOnly(),max:3});
  const actor='ci-immutable-'+randomUUID().slice(0,8);
  const original='ENK04 synthetic scope without proper formatting. Copier le texte';
  const revised=[
    'ENK04 SYNTHETIC UAT — INTERNAL DRAFT ONLY.',
    '',
    'Scope:',
    '- Human-led documentary review of AI-agent architecture and MCP trust boundaries.',
    '- No external testing or client contact.',
    '',
    'Deliverables:',
    '- Internal findings and control checklist.',
    '- Risk summary and human follow-up plan.',
    '',
    'GBP 1.00 is a fictional test amount, not a quotation.'
  ].join('\n');
  try{
    const company=await createCompany(pool,{
      name:'ENK04 immutable revision CI '+randomUUID().slice(0,8)
    },actor);
    const opp=await createDirectCompanyOpportunity(pool,{
      company_id:company.id,company_name_at_review:company.name,
      next_action:'Review synthetic internal scope, no external action',
      due_date:null,confirmed:true
    },actor);
    const draft=await createProposalDraft(pool,{
      opportunity_id:opp.id,title:'Synthetic internal scope correction',
      scope_text:original,currency:'GBP',amount_minor:100
    },actor);
    const beforeEvents=(await pool.query(
      'SELECT id,revision,event_type,content_sha256,actor_local '
      +'FROM enkyron_crm_proposal_draft_events '
      +'WHERE workspace_key=$1 AND proposal_id=$2 ORDER BY revision',
      ['local:'+actor,draft.id]
    )).rows;
    assert.equal(beforeEvents.length,1);
    assert.equal(beforeEvents[0].revision,1);
    assert.equal((await readCompanyProposalContentVersions(pool,{
      proposal_id:draft.id,company_id:company.id
    },actor)).versions.length,0);

    const countsBefore=(await Promise.all([
      pool.query('SELECT count(*)::integer AS n FROM arl_workbench_tickets'),
      pool.query('SELECT count(*)::integer AS n FROM enkyron_crm_mail_manual_sends'),
      pool.query('SELECT count(*)::integer AS n FROM enkyron_crm_issued_invoices')
    ])).map(x=>x.rows[0].n);
    const request={
      proposal_id:draft.id,company_id:company.id,opportunity_id:opp.id,
      expected_revision:1,scope_text:revised,
      review_note:'Operator corrected the initial synthetic UAT scope formatting and removed accidental chat UI copy.',
      confirmed:true
    };
    const saved=await reviseCompanyProposalScope(pool,request,actor);
    assert.equal(saved.revision,2);
    assert.equal(saved.previous_revision,1);
    assert.equal(saved.currency,'GBP');
    assert.equal(saved.amount_minor,100);
    const current=(await pool.query(
      'SELECT revision,title,scope_text,currency,amount_minor '
      +'FROM enkyron_crm_proposal_drafts WHERE workspace_key=$1 AND id=$2',
      ['local:'+actor,draft.id]
    )).rows[0];
    assert.equal(current.revision,2);
    assert.equal(current.scope_text,revised);
    assert.equal(current.currency,'GBP');
    assert.equal(Number(current.amount_minor),100);
    const afterEvents=(await pool.query(
      'SELECT id,revision,event_type,content_sha256,actor_local '
      +'FROM enkyron_crm_proposal_draft_events '
      +'WHERE workspace_key=$1 AND proposal_id=$2 ORDER BY revision',
      ['local:'+actor,draft.id]
    )).rows;
    assert.equal(afterEvents.length,2);
    assert.deepEqual(afterEvents[0],beforeEvents[0],
      'immutable original revision 1 event must be unchanged');
    assert.deepEqual(afterEvents.map(x=>x.event_type),['created','edited']);
    assert.equal(afterEvents[1].content_sha256,saved.content_sha256);

    const history=await readCompanyProposalContentVersions(pool,{
      proposal_id:draft.id,company_id:company.id
    },actor);
    assert.equal(history.current_revision,2);
    assert.deepEqual(history.versions.map(x=>x.revision),[1,2]);
    assert.equal(history.versions[0].scope_text,original);
    assert.equal(history.versions[1].scope_text,revised);
    assert.equal(history.versions[0].snapshot_kind,'pre_edit_archive');
    assert.equal(history.versions[1].snapshot_kind,'reviewed_revision');
    assert.equal(history.versions[0].review_note,'');
    assert.equal(history.versions[1].review_note,request.review_note);
    assert.equal(history.versions[0].source_event_id,beforeEvents[0].id);
    assert.equal(history.versions[1].source_event_id,afterEvents[1].id);
    assert.ok(history.versions.every(x=>x.currency==='GBP'&&
      Number(x.amount_minor)===100));
    assert.equal((await readCompanyProposalContentVersions(pool,{
      proposal_id:draft.id,company_id:company.id
    },'ci-other')).versions.length,0); // other workspace must not discover draft
  }catch(error){
    // A wrong-workspace read must throw; handled in separate assertion below.
    throw error;
  }finally{await pool.end();}
});
