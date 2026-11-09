import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import pg from 'pg';
import {createOpportunity} from '../desktop/enkyron-crm-opportunities.mjs';
import {createProposalDraft,readProposalDraft,updateProposalDraft}
  from '../desktop/enkyron-crm-proposals.mjs';
import {replaceProposalLines,readProposalLines}
  from '../desktop/enkyron-crm-proposal-lines.mjs';
import {readSowSources} from '../desktop/enkyron-crm-sow-sources.mjs';
import {createServiceCatalog,updateServiceCatalog} from '../desktop/enkyron-crm-service-catalog.mjs';
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
    // A priced GBP line cannot be silently re-labelled as EUR through the
    // general proposal editor. This must not create another revision/event.
    await assert.rejects(()=>updateProposalDraft(db,{
      id:proposal.id,expected_revision:2,title:'Synthetic quote draft',
      scope_text:'Human-led analysis of bounded agentic workflow tests.',
      currency:'EUR',amount_minor:250275
    },actor),/currency cannot change after quote lines exist/);
    const unchangedCurrency=await readProposalDraft(db,proposal.id,actor);
    assert.equal(unchangedCurrency.proposal.currency,'GBP');
    assert.equal(unchangedCurrency.proposal.revision,2);
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

    // E07-02: human-authorised catalog selection copies a fee and retains the
    // source version for provenance. A later catalog revision NEVER reprices it.
    const serviceCode='ARL-CI-QUOTED-'+randomUUID().slice(0,6).toUpperCase();
    const service={
      service_code:serviceCode,name:'Synthetic bounded agent assessment',
      family:'agent_assessment',
      summary:'This is an isolated CI service fiche, not a validated commercial offer.',
      inclusions:'A limited hypothetical review of agent permissions and selected controls.',
      exclusions:'No live network testing, production access, or broad pentesting.',
      deliverables:'Synthetic summary and test-only risk findings with human limitations.',
      prerequisites:'Signed client authorisation before any technical security testing.',
      technical_notes:null,
      pricing_model:'fixed',currency:'GBP',price_minor:35000,
      billing_period:null,status:'available',
      review_note:'Synthetic catalog price in isolated database only; no actual sale.',
      confirmed:true
    };
    const catalog=await createServiceCatalog(db,service,actor);
    const catalogLine={
      description:serviceCode+' — '+service.name,
      quantity:1,unit_price_minor:35000,
      source_catalog_id:catalog.id,source_catalog_revision:1
    };
    await assert.rejects(()=>replaceProposalLines(db,{
      proposal_id:proposal.id,expected_revision:3,
      lines:[catalogLine,{...catalogLine,source_catalog_id:randomUUID()}]
    },actor),/catalog version|availability changed/);
    const sourced=await replaceProposalLines(db,{
      proposal_id:proposal.id,expected_revision:3,
      lines:[...updatedLines,catalogLine]
    },actor);
    assert.equal(sourced.revision,4);
    assert.equal(sourced.total_minor,285200);
    const recorded=await readProposalLines(db,proposal.id,actor);
    assert.equal(recorded.lines[2].source_catalog_id,catalog.id);
    assert.equal(recorded.lines[2].source_catalog_revision,1);
    assert.equal(recorded.lines[2].description,catalogLine.description);
    await updateServiceCatalog(db,{
      ...service,id:catalog.id,expected_revision:1,price_minor:99900,
      review_note:'Updated synthetic catalog pricing must not mutate existing quotes.'
    },actor);
    const unchanged=await readProposalLines(db,proposal.id,actor);
    assert.equal(unchanged.lines[2].unit_price_minor,35000);
    assert.equal(unchanged.amount_minor,285200);
    const sow=await readSowSources(db,proposal.id,actor);
    assert.equal(sow.proposal_revision,4);
    assert.equal(sow.lines.length,3);
    assert.equal(sow.lines[0].provenance,null);
    assert.equal(sow.lines[2].provenance.service_code,serviceCode);
    assert.equal(sow.lines[2].provenance.source_catalog_revision,1);
    assert.equal(sow.lines[2].provenance.inclusions,service.inclusions);
    assert.equal(sow.lines[2].provenance.exclusions,service.exclusions);
    assert.equal(sow.lines[2].provenance.deliverables,service.deliverables);
    assert.equal(sow.lines[2].provenance.prerequisites,service.prerequisites);
    assert.equal(sow.terms,null);
    assert.ok(sow.blockers.some(x=>x.includes('No commercial terms')));
    assert.equal(sow.can_approve_sow,false);
    assert.equal(sow.testing_authorised,false);
    await assert.rejects(()=>readSowSources(db,proposal.id,'ci-other'),/not found/);
    await assert.rejects(()=>replaceProposalLines(db,{
      proposal_id:proposal.id,expected_revision:4,
      lines:[...updatedLines,{...catalogLine,quantity:2}]
    },actor),/catalog version|availability changed/);
    const extended=await replaceProposalLines(db,{
      proposal_id:proposal.id,expected_revision:4,
      lines:[{...updatedLines[0],description:'Updated manual service details'},
        updatedLines[1],catalogLine]
    },actor);
    assert.equal(extended.revision,5);
    const versioned=(await db.query(
      'SELECT revision,unit_price_minor,source_catalog_id,source_catalog_revision '
      +'FROM enkyron_crm_proposal_line_versions '
      +'WHERE workspace_key=$1 AND proposal_id=$2 '
      +'AND source_catalog_id=$3 ORDER BY revision',
      ['local:'+actor,proposal.id,catalog.id]
    )).rows;
    assert.deepEqual(versioned.map(x=>x.revision),[4,5]);
    assert.deepEqual(versioned.map(x=>x.unit_price_minor),['35000','35000']);
    assert.deepEqual(versioned.map(x=>x.source_catalog_revision),[1,1]);
    await assert.rejects(()=>db.query(
      'UPDATE enkyron_crm_proposal_line_versions SET unit_price_minor=1 '
      +'WHERE workspace_key=$1 AND proposal_id=$2 AND source_catalog_id=$3',
      ['local:'+actor,proposal.id,catalog.id]
    ),/cannot be changed|immutable|may not/i);

  }finally{await db.end();}
});
