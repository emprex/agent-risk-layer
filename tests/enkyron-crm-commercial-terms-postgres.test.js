import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import pg from 'pg';
import {createOpportunity} from '../desktop/enkyron-crm-opportunities.mjs';
import {createProposalDraft,updateProposalDraft} from '../desktop/enkyron-crm-proposals.mjs';
import {readCommercialTerms,recordCommercialTerms}
  from '../desktop/enkyron-crm-commercial-terms.mjs';

const uri=process.env.ARL_CI_POSTGRES_URL||'';
function disposable(){
  assert.equal(process.env.CI,'true');
  const u=new URL(uri);
  assert.equal(u.hostname,'127.0.0.1');
  assert.equal(u.pathname,'/arl_ci');
  assert.equal(u.username,'arl_ci');
  assert.equal(u.password,'synthetic-ci-only');
  return uri;
}
test('commercial proposal terms: revision binding, immutable history and isolation',{
  skip:!uri&&'Disposable CI PostgreSQL only',timeout:60000
},async()=>{
  const db=new pg.Pool({connectionString:disposable(),max:3});
  const actor='ci-terms-'+randomUUID().slice(0,8);
  try{
    const uid='usr_terms_'+randomUUID();
    const lead='lead_terms_'+randomUUID();
    await db.query(
      'INSERT INTO users(id,email,password_hash,created_at) VALUES($1,$2,$3,NOW())',
      [uid,'ci-terms-'+randomUUID()+'@example.invalid','synthetic']);
    await db.query(
      'INSERT INTO sales_prospects '
      +'(id,company_name,source,created_by,created_at,updated_at) '
      +'VALUES($1,$2,$3,$4,NOW(),NOW())',
      [lead,'Synthetic potential buyer - not verified','synthetic-ci',uid]);
    const opportunity=await createOpportunity(db,{
      prospect_id:lead,company_name_at_review:'Synthetic potential buyer - not verified',
      next_action:'Manually draft commercial conditions',
      due_date:'2026-12-10'
    },actor);
    const proposal=await createProposalDraft(db,{
      opportunity_id:opportunity.id,title:'Manually prepared commercial terms',
      scope_text:'A synthetic proposed review, no permission for security testing.',
      currency:'GBP',amount_minor:70000
    },actor);
    const count=async table=>(await db.query(
      'SELECT count(*)::int AS n FROM '+table
    )).rows[0].n;
    const before={messages:await count('sales_messages'),
      tickets:await count('arl_workbench_tickets'),
      companies:await count('enkyron_crm_companies')};
    const template={
      proposal_id:proposal.id,expected_revision:1,confirmed:true,
      valid_until:'2026-12-31',
      payment_terms:'Payment is discussed only after written proposal approval.',
      delivery_terms:'Delivery dates require written customer agreement before work.',
      exclusions:'No live exploitation, remediation or emergency support is included.',
      assumptions:'This synthetic draft is conditional on approved written project scope.',
      source_reference:'Synthetic operator terms fixture'
    };
    const initial=await readCommercialTerms(db,proposal.id,actor);
    assert.equal(initial.current,null);
    await assert.rejects(
      ()=>readCommercialTerms(db,proposal.id,actor+'-foreign'),/not found/);
    const first=await recordCommercialTerms(db,template,actor);
    assert.equal(first.proposal_revision,1);
    const saved=await readCommercialTerms(db,proposal.id,actor);
    assert.equal(saved.current.valid_until,'2026-12-31');
    assert.equal(saved.current.payment_terms,template.payment_terms);
    assert.equal(saved.current.review_status,'operator_draft_unapproved');
    assert.deepEqual(saved.history.map(x=>x.proposal_revision),[1]);
    await assert.rejects(()=>recordCommercialTerms(db,template,actor),/already recorded/);
    const {rows:[term]}=await db.query(
      'SELECT id FROM enkyron_crm_proposal_commercial_terms '
      +'WHERE workspace_key=$1 AND proposal_id=$2',
      ['local:'+actor,proposal.id]
    );
    await assert.rejects(()=>db.query(
      'UPDATE enkyron_crm_proposal_commercial_terms '
      +'SET payment_terms=$1 WHERE id=$2',['Tamper',term.id]
    ),/cannot be changed or deleted/);
    await assert.rejects(()=>db.query(
      'DELETE FROM enkyron_crm_proposal_commercial_terms WHERE id=$1',[term.id]
    ),/cannot be changed or deleted/);
    const updated=await updateProposalDraft(db,{
      id:proposal.id,expected_revision:1,
      title:'Revised manually prepared commercial terms',
      scope_text:'A synthetic proposed review, no permission for security testing.',
      currency:'GBP',amount_minor:70000
    },actor);
    assert.equal(updated.revision,2);
    const latest=await readCommercialTerms(db,proposal.id,actor);
    assert.equal(latest.current,null);
    assert.equal(latest.history[0].proposal_revision,1);
    await assert.rejects(()=>recordCommercialTerms(db,template,actor),/changed/);
    const next=await recordCommercialTerms(db,{
      ...template,expected_revision:2,
      payment_terms:'Revised payment conditions are to be agreed before issue.'
    },actor);
    assert.equal(next.proposal_revision,2);
    const history=await readCommercialTerms(db,proposal.id,actor);
    assert.deepEqual(history.history.map(x=>x.proposal_revision),[2,1]);
    assert.equal(await count('sales_messages'),before.messages);
    assert.equal(await count('arl_workbench_tickets'),before.tickets);
    assert.equal(await count('enkyron_crm_companies'),before.companies);
    const original=(await db.query(
      'SELECT revision,payment_terms FROM enkyron_crm_proposal_commercial_terms '
      +'WHERE workspace_key=$1 AND proposal_id=$2 AND proposal_revision=1',
      ['local:'+actor,proposal.id]
    )).rows[0];
    assert.equal(original.payment_terms,template.payment_terms);
  }finally{await db.end();}
});
