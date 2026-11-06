import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import pg from 'pg';
import {createOpportunity} from '../desktop/enkyron-crm-opportunities.mjs';
import {createProposalDraft,readProposalDraft,updateProposalDraft}
  from '../desktop/enkyron-crm-proposals.mjs';
import {replaceProposalLines,readProposalLines}
  from '../desktop/enkyron-crm-proposal-lines.mjs';
const uri=process.env.ARL_CI_POSTGRES_URL||'';
function onlyCi(){
  assert.equal(process.env.CI,'true','Use isolated PostgreSQL CI only');
  const u=new URL(uri);
  assert.equal(u.hostname,'127.0.0.1');
  assert.equal(u.pathname,'/arl_ci');
  assert.equal(u.username,'arl_ci');
  assert.equal(u.password,'synthetic-ci-only');
  return uri;
}
test('PostgreSQL quote lines: precise totals, immutable versions, workspace isolation, no delivery', {
  skip:!uri&&'Disposable CI PostgreSQL only',timeout:60_000
},async()=>{
  const db=new pg.Pool({connectionString:onlyCi(),max:3});
  const actor='ci-quotelines-'+randomUUID().slice(0,8);
  try{
    const user='usr_quotelines_'+randomUUID(),lead='lead_quotelines_'+randomUUID();
    await db.query('INSERT INTO users(id,email,password_hash,created_at) VALUES($1,$2,$3,NOW())',
      [user,'ci-'+randomUUID()+'@example.invalid','ci-only']);
    await db.query('INSERT INTO sales_prospects '
      +'(id,company_name,source,created_by,created_at,updated_at) '
      +'VALUES($1,$2,$3,$4,NOW(),NOW())',
      [lead,'Synthetic quote customer','synthetic-ci',user]);
    const opportunity=await createOpportunity(db,{
      prospect_id:lead,company_name_at_review:'Synthetic quote customer',
      next_action:'Review test quote details manually',due_date:'2026-11-12'
    },actor);
    const proposal=await createProposalDraft(db,{
      opportunity_id:opportunity.id,title:'Synthetic quote draft',
      scope_text:'Human-led analysis of bounded agentic workflow tests.',
      currency:'GBP',amount_minor:125050
    },actor);
    const originalOpp=(await db.query('SELECT * FROM enkyron_crm_opportunities WHERE id=$1',
      [opportunity.id])).rows[0];
    const baseline=(await db.query('SELECT count(*)::int AS n FROM sales_messages')).rows[0].n;
    const first=await readProposalLines(db,proposal.id,actor);
    assert.equal(first.revision,1);
    assert.equal(first.uses_lines,false);
    assert.equal(first.amount_minor,125050);
    assert.equal(first.lines.length,0);
    const lines=[
      {description:'Tool inventory and mapping',quantity:2,unit_price_minor:100125},
      {description:'Technical results report',quantity:1,unit_price_minor:50025}
    ];
    const written=await replaceProposalLines(db,{
      proposal_id:proposal.id,expected_revision:1,lines
    },actor);
    assert.equal(written.revision,2);
    assert.equal(written.total_minor,250275);
    const read=await readProposalLines(db,proposal.id,actor);
    assert.equal(read.uses_lines,true);
    assert.deepEqual(read.lines.map(l=>l.line_total_minor),[200250,50025]);
    assert.equal(read.amount_minor,250275);
    const detail=await readProposalDraft(db,proposal.id,actor);
    assert.equal(detail.proposal.has_lines,true);
    assert.equal(detail.proposal.amount_minor,'250275');
    await assert.rejects(()=>updateProposalDraft(db,{
      id:proposal.id,expected_revision:2,title:'Synthetic quote draft',
      scope_text:'Human-led analysis of bounded agentic workflow tests.',
      currency:'GBP',amount_minor:100
    },actor),/computed from quote lines/);
    await assert.rejects(()=>replaceProposalLines(db,{
      proposal_id:proposal.id,expected_revision:1,lines
    },actor),/changed since/);
    await assert.rejects(()=>replaceProposalLines(db,{
      proposal_id:proposal.id,expected_revision:2,lines
    },'ci-foreign'),/not found/);
    await assert.rejects(()=>readProposalLines(db,proposal.id,'ci-foreign'),/not found/);
    const updatedLines=[
      {description:'Tool inventory and mapping',quantity:1,unit_price_minor:100125},
      {description:'Technical results report',quantity:3,unit_price_minor:50025}
    ];
    const second=await replaceProposalLines(db,{
      proposal_id:proposal.id,expected_revision:2,lines:updatedLines
    },actor);
    assert.equal(second.revision,3);
    assert.equal(second.total_minor,250200);
    const snapshots=(await db.query(
      'SELECT revision,position,description,quantity,unit_price_minor '
      +'FROM enkyron_crm_proposal_line_versions WHERE workspace_key=$1 AND proposal_id=$2 '
      +'ORDER BY revision,position',['local:'+actor,proposal.id]
    )).rows;
    assert.equal(snapshots.length,4);
    assert.deepEqual(snapshots.map(r=>r.revision),[2,2,3,3]);
    assert.deepEqual(snapshots.map(r=>r.quantity),[2,1,1,3]);
    const audits=(await db.query(
      'SELECT revision,content_sha256 FROM enkyron_crm_proposal_draft_events '
      +'WHERE workspace_key=$1 AND proposal_id=$2 ORDER BY revision',
      ['local:'+actor,proposal.id]
    )).rows;
    assert.deepEqual(audits.map(r=>r.revision),[1,2,3]);
    assert.ok(audits.every(r=>/^[a-f0-9]{64}$/.test(r.content_sha256)));
    await assert.rejects(()=>db.query(
      'DELETE FROM enkyron_crm_proposal_line_versions WHERE workspace_key=$1 AND proposal_id=$2',
      ['local:'+actor,proposal.id]
    ),/cannot be changed or deleted/);
    assert.deepEqual((await db.query('SELECT * FROM enkyron_crm_opportunities WHERE id=$1',
      [opportunity.id])).rows[0],originalOpp);
    assert.equal((await db.query('SELECT count(*)::int AS n FROM sales_messages')).rows[0].n,
      baseline);
    assert.equal((await db.query('SELECT amount_minor FROM enkyron_crm_proposal_drafts WHERE id=$1',
      [proposal.id])).rows[0].amount_minor,'250200');
  }finally{await db.end();}
});
